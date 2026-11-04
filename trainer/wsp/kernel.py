#!/usr/bin/env python3
"""Runs one program Astra wrote against a base checkpoint's weights (decision 109).

    python -I kernel.py REQUEST.json

The request names the base folder (read only), the candidate the program builds on, the session's
folders, the practice outputs Astra may read and the limits. The program runs with these names:

    weights       the model's tensors: names(), shape(name), dtype(name), get(name) as float32,
                  config (its config.json)
    save_edit     save_edit(name, tensor): a whole replacement for one tensor, checked at once
    request_read  request_read(name, texts, layers): asks the runner for hidden states after the
                  program ends; a later program loads them with load_read(name)
    load_read     the arrays of an earlier read, by name
    practice      the incumbent's practice outputs: prompt, output, passed, looped
    scratch       a folder kept across programs, for np.save and np.load
    torch, np, math

It prints a JSON line with what the program saved and asked for. The program can't run the model:
outputs come only from the runner's evaluator, between programs.
"""

from __future__ import annotations

import contextlib
import io
import json
import math
import sys
import traceback
from pathlib import Path

import numpy as np
import torch

# `python -I` leaves the script's own folder off the path; the worker's modules live beside it.
sys.path.insert(0, str(Path(__file__).resolve().parent))

import wsp_guard  # noqa: E402
import wsp_tensors  # noqa: E402

MAX_OUTPUT = 8_000
MAX_READ_TEXTS = 64
MAX_READ_CHARS = 2_000


class Weights:
    def __init__(self, base: wsp_tensors.BaseWeights, incumbent: dict, config: dict) -> None:
        self._base = base
        self._incumbent = incumbent
        self.config = config

    def names(self) -> list[str]:
        return self._base.names()

    def shape(self, name: str) -> list[int]:
        return self._base.shape(name)

    def dtype(self, name: str) -> str:
        return self._base.dtype(name)

    def get(self, name: str) -> torch.Tensor:
        # Always a copy: for a float32 base, .float() is the memory-mapped tensor itself, and an
        # edit in place would change what the edit is then checked against.
        if name in self._incumbent:
            return self._incumbent[name].float().clone()
        return self._base.load(name).float().clone()

    def __repr__(self) -> str:
        return f"<weights: {len(self.names())} tensors, {self._base.parameters():,} parameters>"


def main() -> int:
    # Only the result goes to stdout; whatever a library prints goes to stderr.
    result_out = sys.stdout
    sys.stdout = sys.stderr
    request = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    base_dir = Path(request["base"])
    out_dir = Path(request["out"])
    scratch = Path(request["scratch"])
    reads_dir = Path(request["reads"])
    out_dir.mkdir(parents=True, exist_ok=True)
    scratch.mkdir(parents=True, exist_ok=True)
    reads_dir.mkdir(parents=True, exist_ok=True)
    torch.set_num_threads(wsp_tensors.env_threads())

    base = wsp_tensors.BaseWeights(base_dir)
    config = json.loads((base_dir / "config.json").read_text(encoding="utf-8"))
    incumbent_path = request.get("incumbent")
    incumbent = wsp_tensors.load_tensors(Path(incumbent_path)) if incumbent_path else {}
    weights = Weights(base, incumbent, config)
    saved: dict[str, torch.Tensor] = {}
    reads: list[dict] = []
    refused: list[str] = []
    program = Path(request["program"]).read_text(encoding="utf-8")

    def save_edit(name: str, tensor: torch.Tensor) -> None:
        try:
            saved[name] = wsp_tensors.check_edit(base, name, tensor)
        except ValueError as error:
            refused.append(str(error))
            raise

    def request_read(name: str, texts: list[str], layers: list[int]) -> None:
        if not isinstance(name, str) or not name.isidentifier():
            raise ValueError("a read's name must be a plain identifier")
        if not texts or len(texts) > MAX_READ_TEXTS:
            raise ValueError(f"a read takes 1 to {MAX_READ_TEXTS} texts")
        if any(not isinstance(t, str) or len(t) > MAX_READ_CHARS for t in texts):
            raise ValueError(f"each text is a string of at most {MAX_READ_CHARS} characters")
        count = int(config.get("num_hidden_layers") or 0)
        if not layers or any(not isinstance(l, int) or l < 0 or l > count for l in layers):
            raise ValueError(f"layers are hidden-state indices from 0 to {count}")
        reads.append({"name": name, "texts": list(texts), "layers": sorted(set(layers))})

    def load_read(name: str) -> dict:
        path = reads_dir / f"{name}.npz"
        if not path.exists():
            raise KeyError(f"No read named {name} yet")
        with np.load(path) as data:
            return {key: data[key] for key in data.files}

    namespace = {
        "__name__": "__wsp__",
        "weights": weights,
        "save_edit": save_edit,
        "request_read": request_read,
        "load_read": load_read,
        "practice": request.get("practice", []),
        "scratch": str(scratch),
        "torch": torch,
        "np": np,
        "math": math,
    }

    # torch writes and reads files from native code, which no audit hook sees: those entry points
    # are closed before the program runs. safetensors, which does the same, is among the modules
    # the guard takes out of reach.
    def closed(*_args, **_kwargs):
        raise wsp_guard.GuardRefusal("this file call is not available here; use np.save in scratch")

    torch.save = closed
    torch.load = closed
    torch.from_file = closed
    torch.UntypedStorage.from_file = closed

    watcher = wsp_guard.start_memory_watch(int(request["memoryBytes"]))
    read_roots = [str(base_dir), str(reads_dir)]
    if incumbent_path:
        read_roots.append(str(Path(incumbent_path).parent))
    wsp_guard.install(read_roots, [str(out_dir), str(scratch)], watcher)

    printed = io.StringIO()
    status, error = "ok", None
    try:
        with contextlib.redirect_stdout(printed), contextlib.redirect_stderr(printed):
            exec(compile(program, "program.py", "exec"), namespace)
    except BaseException as caught:  # the program's failure is reported, never raised
        status = "error"
        error = "".join(traceback.format_exception_only(type(caught), caught)).strip()
        tb = traceback.extract_tb(caught.__traceback__)
        lines = [f"line {frame.lineno}" for frame in tb if frame.filename == "program.py"]
        if lines:
            error = f"{error} (at {lines[-1]})"

    # The edits leave as plain float32 arrays (exact for bf16 and fp16), one file each; the
    # runner's evaluator checks them against the base again and writes the candidate.
    edits = None
    if saved and status == "ok":
        files = {}
        for index, name in enumerate(sorted(saved)):
            file = f"edit-{index}.npy"
            np.save(out_dir / file, saved[name].float().numpy())
            files[name] = file
        edits = {"files": files}
    text = printed.getvalue()
    if len(text) > MAX_OUTPUT:
        text = "[...]\n" + text[-MAX_OUTPUT:]
    result_out.write(
        json.dumps(
            {
                "status": status,
                "error": error,
                "output": text,
                "edits": edits,
                "reads": reads if status == "ok" else [],
                "refused": refused,
            }
        )
        + "\n"
    )
    result_out.flush()
    return 0


if __name__ == "__main__":
    sys.exit(main())
