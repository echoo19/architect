"""Reading a base checkpoint's tensors and checking a candidate's, for the WSP worker.

Shared by the kernel (which runs Astra's programs) and the evaluator (which the runner owns). The
base is only ever opened for reading.
"""

from __future__ import annotations

import hashlib
import json
import os
import struct
from pathlib import Path

import torch
from safetensors import safe_open
from safetensors.torch import save_file

# Tensors no program may replace: the embedding, the output head and the final norm, whose
# changes reach every token and say nothing about a targeted repair.
PROTECTED_SUFFIXES = ("embed_tokens.weight", "lm_head.weight", "model.norm.weight", "wte.weight")


def header(path: Path) -> dict:
    with open(path, "rb") as fh:
        size = struct.unpack("<Q", fh.read(8))[0]
        return json.loads(fh.read(size))


def tensor_files(base: Path) -> list[Path]:
    files = sorted(base.glob("*.safetensors"))
    if not files:
        raise FileNotFoundError(f"No .safetensors files in {base}")
    return files


def is_protected(name: str) -> bool:
    return name.endswith(PROTECTED_SUFFIXES)


def tensor_sha256(tensor: torch.Tensor) -> str:
    data = tensor.detach().contiguous().cpu()
    if data.dtype == torch.bfloat16:
        data = data.view(torch.int16)
    return hashlib.sha256(data.numpy().tobytes()).hexdigest()


class BaseWeights:
    """Every tensor of the base by name, read lazily from its files, never written."""

    def __init__(self, base: Path) -> None:
        self.base = base
        self._where: dict[str, Path] = {}
        self._meta: dict[str, tuple[str, list[int]]] = {}
        self._handles = {}
        for file in tensor_files(base):
            self._handles[file] = safe_open(str(file), framework="pt", device="cpu")
            for name, info in header(file).items():
                if name == "__metadata__":
                    continue
                self._where[name] = file
                self._meta[name] = (info["dtype"], list(info["shape"]))

    def names(self) -> list[str]:
        return sorted(self._where)

    def shape(self, name: str) -> list[int]:
        return list(self._meta[name][1])

    def dtype(self, name: str) -> str:
        return self._meta[name][0]

    def load(self, name: str) -> torch.Tensor:
        if name not in self._where:
            raise KeyError(f"No tensor named {name}")
        return self._handles[self._where[name]].get_tensor(name)

    def parameters(self) -> int:
        total = 0
        for _, shape in self._meta.values():
            count = 1
            for dim in shape:
                count *= dim
            total += count
        return total


def load_tensors(path: Path) -> dict[str, torch.Tensor]:
    out = {}
    with safe_open(str(path), framework="pt", device="cpu") as handle:
        for name in handle.keys():
            out[name] = handle.get_tensor(name)
    return out


def check_edit(base: BaseWeights, name: str, tensor: torch.Tensor) -> torch.Tensor:
    """The replacement as the base stores it, or a ValueError saying why it is refused."""
    if name not in base._where:
        raise ValueError(f"{name} is not a tensor of this model")
    if is_protected(name):
        raise ValueError(f"{name} may not be edited: the embedding, output head and final norm stay")
    if not isinstance(tensor, torch.Tensor):
        raise ValueError(f"{name}: an edit must be a torch tensor")
    if list(tensor.shape) != base.shape(name):
        raise ValueError(f"{name}: shape {list(tensor.shape)} is not the base's {base.shape(name)}")
    if not torch.isfinite(tensor.float()).all():
        raise ValueError(f"{name}: the edit has values that are not finite")
    original = base.load(name)
    stored = tensor.detach().to(original.dtype).contiguous()
    if not torch.isfinite(stored.float()).all():
        raise ValueError(f"{name}: the edit overflows {original.dtype}")
    if torch.equal(stored, original):
        raise ValueError(f"{name}: the edit changes nothing once stored as {original.dtype}")
    o = original.float()
    s = stored.float()
    denom = float((o * o).sum())
    if denom > 0:
        scale = float((o * s).sum()) / denom
        if scale != 0 and torch.allclose(s, o * scale, rtol=1e-3, atol=1e-6):
            raise ValueError(f"{name}: scaling a whole tensor by one number is not a targeted edit")
    return stored


def edit_stats(base: BaseWeights, name: str, stored: torch.Tensor) -> dict:
    original = base.load(name)
    o = original.float()
    s = stored.float()
    norm = float(o.norm())
    return {
        "tensor": name,
        "shape": list(stored.shape),
        "dtype": base.dtype(name),
        "sha256": tensor_sha256(stored),
        "changed": int((stored != original).sum()),
        "total": int(stored.numel()),
        "relativeChange": float((s - o).norm()) / norm if norm > 0 else 0.0,
    }


def write_candidate(tensors: dict[str, torch.Tensor], path: Path) -> str:
    """Writes the candidate's tensors and returns the file's SHA-256."""
    path.parent.mkdir(parents=True, exist_ok=True)
    save_file({k: v.contiguous() for k, v in sorted(tensors.items())}, str(path))
    digest = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def env_threads() -> int:
    return max(1, int(os.environ.get("WSP_THREADS", "4")))
