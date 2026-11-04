#!/usr/bin/env python3
"""A benchmark for Architect WSP (decision 109): small models with a known, planted fault.

    python make_bench.py OUT_DIR [--faults 8] [--seed 7]

It trains one tiny Llama-architecture language model on this computer's CPU to reverse a string
of letters ("abcdef=" -> "fedcba"), then writes damaged copies of it, each with one fault planted
in one tensor:

    spike   a rank-one matrix added to one MLP down projection or attention output projection,
            large enough to break the model; removing it restores the healthy tensor exactly
    row     one output row of such a tensor multiplied by a large factor

Each copy is a whole Hugging Face checkpoint (config.json, model.safetensors and a character
tokenizer) that Architect WSP can open as a base. Beside them it writes the examples, made from
strings the model never trained on, and `bench.json`: where every fault is, the healthy model's
accuracy and each copy's, on the same held-out strings. The mentor is never shown bench.json or
the healthy checkpoint; they are for scoring.
"""

from __future__ import annotations

import argparse
import json
import random
import string
from pathlib import Path

import torch
from tokenizers import Regex, Tokenizer, decoders, models, pre_tokenizers, processors
from transformers import LlamaConfig, LlamaForCausalLM, PreTrainedTokenizerFast

LETTERS = string.ascii_lowercase[:12]
LENGTH = 6
SPECIAL = ["<pad>", "<s>", "</s>"]


def tokenizer() -> PreTrainedTokenizerFast:
    vocab = {token: i for i, token in enumerate(SPECIAL + list(LETTERS) + ["="])}
    core = Tokenizer(models.WordLevel(vocab=vocab, unk_token="<pad>"))
    core.pre_tokenizer = pre_tokenizers.Split(Regex("."), behavior="isolated")
    core.decoder = decoders.Fuse()
    # Every prompt starts with <s>, as in training, wherever the tokenizer is used.
    core.post_processor = processors.TemplateProcessing(
        single="<s> $A", special_tokens=[("<s>", vocab["<s>"])]
    )
    return PreTrainedTokenizerFast(
        tokenizer_object=core, pad_token="<pad>", bos_token="<s>", eos_token="</s>"
    )


def word(rng: random.Random) -> str:
    return "".join(rng.choice(LETTERS) for _ in range(LENGTH))


def encode(tok, text: str) -> list[int]:
    return [tok.bos_token_id] + tok(text, add_special_tokens=False)["input_ids"]


def accuracy(model, tok, words: list[str]) -> float:
    model.eval()
    right = 0
    with torch.no_grad():
        for w in words:
            ids = torch.tensor([encode(tok, w + "=")])
            out = model.generate(ids, max_new_tokens=LENGTH + 1, do_sample=False, pad_token_id=0)
            text = tok.decode(out[0, ids.shape[1] :], skip_special_tokens=True).replace(" ", "")
            right += text == w[::-1]
    return right / len(words)


def train(seed: int, tok, held_out: set[str]) -> LlamaForCausalLM:
    torch.manual_seed(seed)
    rng = random.Random(seed)
    config = LlamaConfig(
        vocab_size=len(tok),
        hidden_size=64,
        intermediate_size=128,
        num_hidden_layers=2,
        num_attention_heads=4,
        num_key_value_heads=4,
        max_position_embeddings=32,
        bos_token_id=tok.bos_token_id,
        eos_token_id=tok.eos_token_id,
        pad_token_id=tok.pad_token_id,
        tie_word_embeddings=False,
    )
    model = LlamaForCausalLM(config)
    optimizer = torch.optim.AdamW(model.parameters(), lr=3e-3, weight_decay=0.01)
    for step in range(4000):
        batch = []
        while len(batch) < 128:
            w = word(rng)
            if w not in held_out:
                batch.append(encode(tok, w + "=" + w[::-1]) + [tok.eos_token_id])
        ids = torch.tensor(batch)
        labels = ids.clone()
        labels[:, : LENGTH + 2] = -100  # learn only the answer and its end
        loss = model(input_ids=ids, labels=labels).loss
        optimizer.zero_grad()
        loss.backward()
        optimizer.step()
        if step % 500 == 0:
            print(f"step {step} loss {loss.item():.4f}", flush=True)
    return model


TARGETS = ["mlp.down_proj.weight", "self_attn.o_proj.weight"]


def plant(model, kind: str, rng: random.Random) -> dict:
    """One fault in one tensor; returns where it is and how big."""
    layer = rng.randrange(model.config.num_hidden_layers)
    name = f"model.layers.{layer}.{rng.choice(TARGETS)}"
    weight = dict(model.named_parameters())[name]
    with torch.no_grad():
        if kind == "spike":
            u = torch.randn(weight.shape[0])
            v = torch.randn(weight.shape[1])
            u, v = u / u.norm(), v / v.norm()
            scale = float(torch.linalg.matrix_norm(weight, ord=2)) * rng.uniform(4, 8)
            weight += scale * torch.outer(u, v)
            return {"kind": kind, "tensor": name, "scale": scale}
        row = rng.randrange(weight.shape[0])
        factor = rng.uniform(25, 60) * rng.choice([1, -1])
        weight[row] *= factor
        return {"kind": kind, "tensor": name, "row": row, "factor": factor}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("out")
    parser.add_argument("--faults", type=int, default=8)
    parser.add_argument("--seed", type=int, default=7)
    args = parser.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    tok = tokenizer()
    rng = random.Random(args.seed)
    held = sorted({word(rng) for _ in range(400)})[:200]
    model = train(args.seed, tok, set(held))
    healthy_dir = out / "healthy"
    model.save_pretrained(healthy_dir, safe_serialization=True)
    tok.save_pretrained(healthy_dir)
    healthy = accuracy(model, tok, held)
    print(f"healthy accuracy on held-out strings: {healthy:.3f}", flush=True)
    examples = [
        {"prompt": w + "=", "check": {"kind": "exact", "value": w[::-1]}} for w in held[:40]
    ]
    (out / "examples.json").write_text(json.dumps(examples, indent=1), encoding="utf-8")
    faults = []
    planted = 0
    attempt = 0
    while planted < args.faults:
        attempt += 1
        kind = "spike" if planted % 2 == 0 else "row"
        damaged = LlamaForCausalLM.from_pretrained(healthy_dir)
        fault = plant(damaged, kind, random.Random(args.seed * 1000 + attempt))
        score = accuracy(damaged, tok, held)
        if score > healthy - 0.4:
            continue  # too mild to count as broken; plant another
        planted += 1
        folder = out / f"fault-{planted:02d}"
        damaged.save_pretrained(folder, safe_serialization=True)
        tok.save_pretrained(folder)
        faults.append({**fault, "folder": folder.name, "accuracy": score})
        print(f"{folder.name}: {fault['kind']} in {fault['tensor']}, accuracy {score:.3f}", flush=True)
    (out / "bench.json").write_text(
        json.dumps(
            {
                "task": "reverse a string of six letters from a to l",
                "held_out": len(held),
                "healthy_accuracy": healthy,
                "faults": faults,
            },
            indent=1,
        ),
        encoding="utf-8",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
