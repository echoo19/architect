#!/usr/bin/env python3
"""The runner's evaluator for Architect WSP (decision 109): the only process that runs the model.

    python -I evaluator.py BASE_DIR SESSION_DIR

It answers one JSON request a line on stdin with one JSON line on stdout:

    info                                  versions and the model's size
    compose   {folder, files, incumbent, out}   checks a kernel's tensors against the base and
                                          writes the candidate's file over the incumbent's
    generate  {candidate, prompts, system, decoding, seed}
    read      {candidate, texts, layers, out}   hidden states, mean and last token, per layer
    materialize {candidate, out}          the whole checkpoint with the candidate's tensors

It runs only the runner's code. No program Astra wrote ever runs here, and it reaches no network.
"""

from __future__ import annotations

import hashlib
import json
import os
import platform
import shutil
import sys
import time
import traceback
from pathlib import Path

import numpy as np
import torch

# `python -I` leaves the script's own folder off the path; the worker's modules live beside it.
sys.path.insert(0, str(Path(__file__).resolve().parent))

import wsp_guard  # noqa: E402
import wsp_tensors  # noqa: E402


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


class Evaluator:
    def __init__(self, base_dir: Path, session: Path) -> None:
        import transformers
        from transformers import AutoModelForCausalLM, AutoTokenizer

        self.base_dir = base_dir
        self.session = session
        self.base = wsp_tensors.BaseWeights(base_dir)
        torch.set_num_threads(wsp_tensors.env_threads())
        dtype = torch.float32 if self.base.parameters() < 4_000_000_000 else torch.bfloat16
        self.tokenizer = AutoTokenizer.from_pretrained(str(base_dir), local_files_only=True)
        if self.tokenizer.pad_token is None:
            self.tokenizer.pad_token = self.tokenizer.eos_token
        self.tokenizer.padding_side = "left"
        self.model = AutoModelForCausalLM.from_pretrained(
            str(base_dir), local_files_only=True, dtype=dtype, trust_remote_code=False
        )
        self.model.eval()
        self.params = dict(self.model.named_parameters())
        self.swapped: dict[str, torch.Tensor] = {}
        self.loaded: str | None = None
        self.versions = {
            "python": platform.python_version(),
            "torch": torch.__version__,
            "transformers": transformers.__version__,
        }

    # Candidates

    def _param(self, name: str) -> torch.nn.Parameter:
        if name in self.params:
            return self.params[name]
        raise ValueError(f"{name} is not a parameter of the loaded model")

    def use(self, candidate: str | None) -> None:
        """Puts the candidate's tensors in the model, or the base's back for None."""
        if candidate == self.loaded:
            return
        with torch.no_grad():
            for name, original in self.swapped.items():
                self._param(name).copy_(original)
            self.swapped = {}
            self.loaded = None
            if candidate:
                for name, tensor in wsp_tensors.load_tensors(Path(candidate)).items():
                    param = self._param(name)
                    self.swapped[name] = param.detach().clone()
                    param.copy_(tensor.to(param.dtype))
        self.loaded = candidate

    def compose(self, request: dict) -> dict:
        """The kernel's new tensors over the incumbent's, checked against the base and written."""
        files = request["files"]
        if not files:
            raise ValueError("The program saved no tensor")
        folder = Path(request["folder"])
        merged = wsp_tensors.load_tensors(Path(request["incumbent"])) if request.get("incumbent") else {}
        for name, file in sorted(files.items()):
            array = np.load(folder / Path(file).name, allow_pickle=False)
            merged[name] = wsp_tensors.check_edit(self.base, name, torch.from_numpy(array))
        edits = [wsp_tensors.edit_stats(self.base, name, merged[name]) for name in sorted(merged)]
        sha = wsp_tensors.write_candidate(merged, Path(request["out"]))
        return {"edits": edits, "sha256": sha, "parameters": self.base.parameters()}

    # Running the model

    def _encode(self, prompts: list[str], system: str | None) -> dict:
        texts = []
        for prompt in prompts:
            messages = ([{"role": "system", "content": system}] if system else []) + [
                {"role": "user", "content": prompt}
            ]
            if self.tokenizer.chat_template:
                texts.append(
                    self.tokenizer.apply_chat_template(
                        messages, tokenize=False, add_generation_prompt=True, enable_thinking=False
                    )
                )
            else:
                texts.append(((system + "\n\n") if system else "") + prompt)
        return self.tokenizer(texts, return_tensors="pt", padding=True)

    def generate(self, request: dict) -> dict:
        self.use(request.get("candidate"))
        decoding = request["decoding"]
        batch = int(request.get("batch", 8))
        outputs = []
        prompts = request["prompts"]
        eos = self.tokenizer.eos_token_id
        eos_ids = set(eos if isinstance(eos, list) else [eos])
        if self.model.generation_config.eos_token_id is not None:
            gen_eos = self.model.generation_config.eos_token_id
            eos_ids |= set(gen_eos if isinstance(gen_eos, list) else [gen_eos])
        for start in range(0, len(prompts), batch):
            torch.manual_seed(int(request.get("seed", 0)) + start)
            encoded = self._encode(prompts[start : start + batch], request.get("system"))
            sample = decoding["temperature"] > 0
            settings = {
                "max_new_tokens": decoding["maxNewTokens"],
                "do_sample": sample,
                "repetition_penalty": decoding["repetitionPenalty"],
                "pad_token_id": self.tokenizer.pad_token_id,
            }
            if sample:
                settings.update(temperature=decoding["temperature"], top_p=decoding["topP"])
            with torch.no_grad():
                generated = self.model.generate(**encoded, **settings)
            width = encoded["input_ids"].shape[1]
            for row in generated[:, width:]:
                ids = row.tolist()
                length = len(ids)
                ended = False
                for index, token in enumerate(ids):
                    if token in eos_ids:
                        length = index
                        ended = True
                        break
                outputs.append(
                    {
                        "text": self.tokenizer.decode(ids[:length], skip_special_tokens=True),
                        "tokens": length,
                        "cutOff": not ended and length >= decoding["maxNewTokens"],
                    }
                )
        return {"outputs": outputs}

    def read(self, request: dict) -> dict:
        self.use(request.get("candidate"))
        layers = [int(layer) for layer in request["layers"]]
        arrays: dict[str, list] = {}
        for text in request["texts"]:
            encoded = self.tokenizer([text], return_tensors="pt")
            with torch.no_grad():
                out = self.model(**encoded, output_hidden_states=True)
            for layer in layers:
                states = out.hidden_states[layer][0].float()
                arrays.setdefault(f"mean_{layer}", []).append(states.mean(0).numpy())
                arrays.setdefault(f"last_{layer}", []).append(states[-1].numpy())
        target = Path(request["out"])
        target.parent.mkdir(parents=True, exist_ok=True)
        np.savez(target, **{key: np.stack(value) for key, value in arrays.items()})
        return {"file": str(target), "sha256": sha256_file(target)}

    def materialize(self, request: dict) -> dict:
        out = Path(request["out"])
        out.mkdir(parents=True, exist_ok=False)
        replaced = wsp_tensors.load_tensors(Path(request["candidate"]))
        from safetensors.torch import save_file

        written = []
        for file in wsp_tensors.tensor_files(self.base_dir):
            names = [n for n in wsp_tensors.header(file) if n != "__metadata__"]
            if any(name in replaced for name in names):
                tensors = {n: replaced.get(n, self.base.load(n)).contiguous() for n in names}
                save_file(tensors, str(out / file.name), metadata={"format": "pt"})
            else:
                shutil.copyfile(file, out / file.name)
            written.append(file.name)
        for item in sorted(self.base_dir.iterdir()):
            if item.is_file() and item.suffix != ".safetensors":
                shutil.copyfile(item, out / item.name)
        files = [
            {"name": p.name, "bytes": p.stat().st_size, "sha256": sha256_file(p)}
            for p in sorted(out.iterdir())
        ]
        return {"files": files}


def main() -> int:
    base_dir = Path(sys.argv[1])
    session = Path(sys.argv[2])
    # Only the replies go to stdout; whatever a library prints goes to stderr.
    replies = sys.stdout
    sys.stdout = sys.stderr
    if os.environ.get("WSP_MEMORY_BYTES"):
        wsp_guard.start_memory_watch(int(os.environ["WSP_MEMORY_BYTES"]))
    try:
        evaluator = Evaluator(base_dir, session)
    except Exception as error:  # reported to the runner, which shows it
        replies.write(json.dumps({"ready": False, "error": str(error)}) + "\n")
        replies.flush()
        return 1
    wsp_guard.install_network_only()
    replies.write(
        json.dumps(
            {
                "ready": True,
                **evaluator.versions,
                "parameters": evaluator.base.parameters(),
            }
        )
        + "\n"
    )
    replies.flush()
    handlers = {
        "compose": evaluator.compose,
        "generate": evaluator.generate,
        "read": evaluator.read,
        "materialize": evaluator.materialize,
    }
    for line in sys.stdin:
        if not line.strip():
            continue
        request = json.loads(line)
        started = time.monotonic()
        try:
            result = handlers[request["op"]](request)
            reply = {"id": request["id"], "ok": True, **result}
        except Exception as error:  # every failure goes back to the runner with its reason
            reply = {
                "id": request["id"],
                "ok": False,
                "error": str(error) or type(error).__name__,
                "trace": traceback.format_exc(limit=3),
            }
        reply["seconds"] = round(time.monotonic() - started, 3)
        replies.write(json.dumps(reply) + "\n")
        replies.flush()
    return 0


if __name__ == "__main__":
    sys.exit(main())
