#!/usr/bin/env python3
"""One Architect training job, from checked inputs to a GGUF LoRA with a manifest of hashes.

    python pipeline.py --job job.json --inputs DIR --out DIR [--dry-run] [--upload]

The inputs folder holds job.json, recipe.json, dataset.json, examples.jsonl and the recipe's
scripts. The steps:

1. Check: the job matches the recipe it names (by hash and by every pinned setting), the
   examples match the dataset's hash and count, and every example is well formed.
   ``--dry-run`` stops here and prints a summary as JSON; it needs only the standard library.
2. Install the pinned packages.
3. Train a QLoRA adapter (train_qlora.py) and save it in PEFT's format.
4. Write outputs/peft-manifest.json with the PEFT files' and the log's SHA-256, and with
   ``--upload`` send them to the job's repository first, so a failed conversion never loses the
   trained weights.
5. Convert it with llama.cpp's convert_lora_to_gguf.py at the pinned commit, in its own
   environment with that commit's own requirements.
6. Write outputs/manifest.json with every file's SHA-256, and with ``--upload`` send the GGUF
   adapter and the manifest beside the PEFT files.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
import platform
import shutil
import subprocess
import sys
import time
from pathlib import Path

import chat_spans

JOB_FORMAT = "architect.trainer-job/1"
RECIPE_FORMAT = "architect.trainer-recipe/1"
DATASET_FORMAT = "architect.chat-dataset/1"
OUTPUT_FORMAT = "architect.trainer-output/1"
PEFT_FORMAT = "architect.trainer-peft/1"
PINNED = ("python_packages", "quantization", "lora", "training", "converter")
# Time kept back from training for converting and uploading.
RESERVE_SECONDS = 15 * 60


class JobError(Exception):
    """The job can't run as given; the message says why."""


def log(message: str) -> None:
    print(f"[architect] {message}", flush=True)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def read_json(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        raise JobError(f"{path.name} can't be read: {error}") from error


def load(job_path: Path, inputs: Path) -> tuple:
    """Checks everything the job depends on and returns (job, recipe, examples)."""
    job = read_json(job_path)
    if job.get("format") != JOB_FORMAT:
        raise JobError(f"job.json is not {JOB_FORMAT}")
    recipe_path = inputs / "recipe.json"
    recipe = read_json(recipe_path)
    if recipe.get("format") != RECIPE_FORMAT:
        raise JobError(f"recipe.json is not {RECIPE_FORMAT}")
    if sha256_file(recipe_path) != job["recipe"]["sha256"]:
        raise JobError("recipe.json is not the recipe the job was made from")
    for key in PINNED:
        if job[key] != recipe[key]:
            raise JobError(f"the job's {key} differs from the recipe's")
    for name in recipe["files"]:
        if not (inputs / name).is_file():
            raise JobError(f"the recipe's file {name} is missing")

    dataset = read_json(inputs / "dataset.json")
    if dataset.get("format") != DATASET_FORMAT:
        raise JobError(f"dataset.json is not {DATASET_FORMAT}")
    examples_path = inputs / "examples.jsonl"
    digest = sha256_file(examples_path)
    if digest != dataset["examples_sha256"] or digest != job["dataset"]["sha256"]:
        raise JobError("examples.jsonl is not the dataset the job was made from")
    examples = []
    # Only a newline ends a line here: JSON may hold U+2028 and the other characters that
    # str.splitlines() also splits on.
    for number, line in enumerate(examples_path.read_text(encoding="utf-8").split("\n"), 1):
        if not line.strip():
            continue
        example = json.loads(line)
        try:
            chat_spans.validate_example(example)
        except chat_spans.ExampleError as error:
            raise JobError(f"example {number} ({example.get('id')}): {error}") from error
        examples.append(example)
    if len(examples) != dataset["example_count"] or len(examples) != job["dataset"]["example_count"]:
        raise JobError("the number of examples doesn't match the dataset")
    return job, recipe, examples


def summary(job: dict, examples: list) -> dict:
    categories: dict = {}
    for example in examples:
        categories[example["category"]] = categories.get(example["category"], 0) + 1
    return {
        "ok": True,
        "job_id": job["job_id"],
        "base_model": job["base_model"],
        "examples": len(examples),
        "trained_turns": sum(chat_spans.validate_example(example) for example in examples),
        "categories": dict(sorted(categories.items())),
        "lora": {"r": job["lora"]["r"], "alpha": job["lora"]["alpha"]},
        "max_seconds": job["max_seconds"],
    }


def run(command: list, **options) -> subprocess.CompletedProcess:
    log("$ " + " ".join(str(part) for part in command))
    return subprocess.run([str(part) for part in command], check=True, **options)


def install(packages: list) -> None:
    run([sys.executable, "-m", "pip", "install", "--no-cache-dir", "--quiet", *packages])


def versions() -> dict:
    from importlib import metadata

    found = {"python": platform.python_version()}
    for name in ("torch", "transformers", "tokenizers", "peft", "bitsandbytes", "accelerate", "safetensors", "huggingface_hub"):
        try:
            found[name] = metadata.version(name)
        except metadata.PackageNotFoundError:
            found[name] = "not installed"
    return found


def system_packages(has_git: bool, has_ensurepip: bool, version: tuple) -> list:
    """The apt packages the converter's steps need that the image lacks: git to fetch llama.cpp,
    and the venv module's ensurepip, without which an environment of its own can't be made. The
    recipe's image has neither (checked Nov 1)."""
    needed = []
    if not has_git:
        needed += ["git", "ca-certificates"]
    if not has_ensurepip:
        needed.append(f"python{version[0]}.{version[1]}-venv")
    return needed


def convert(job: dict, base_dir: str, peft_dir: Path, gguf_path: Path, work: Path) -> float:
    """llama.cpp's converter at the pinned commit, in a fresh environment of its own."""
    started = time.monotonic()
    converter = job["converter"]
    source = work / "llama.cpp"
    needed = system_packages(
        shutil.which("git") is not None,
        importlib.util.find_spec("ensurepip") is not None,
        sys.version_info,
    )
    if needed:
        run(["apt-get", "update", "-qq"])
        run(["apt-get", "install", "-y", "-qq", "--no-install-recommends", *needed])
    run(["git", "init", "-q", source])
    run(["git", "-C", source, "fetch", "-q", "--depth", "1", converter["repo"], converter["commit"]])
    run(["git", "-C", source, "checkout", "-q", "FETCH_HEAD"])
    head = run(["git", "-C", source, "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
    if head != converter["commit"]:
        raise JobError(f"llama.cpp checked out at {head}, not {converter['commit']}")
    venv = work / "convert-env"
    run([sys.executable, "-m", "venv", venv])
    python = venv / "bin" / "python"
    run([python, "-m", "pip", "install", "--no-cache-dir", "--quiet", "-r", source / "requirements" / "requirements-convert_lora_to_gguf.txt"])
    run([python, source / "convert_lora_to_gguf.py", "--base", base_dir, "--outtype", converter["outtype"], "--outfile", gguf_path, peft_dir])
    return round(time.monotonic() - started, 1)


KINDS = {
    "peft/adapter_config.json": "peft_config",
    "peft/adapter_model.safetensors": "peft_weights",
    "adapter.gguf": "gguf_lora",
    "train.log": "log",
}


def file_entries(out: Path, required: tuple, kinds: tuple = tuple(KINDS.values())) -> list:
    """Every output file of the given kinds, with its hash; a required kind that is missing fails."""
    files = []
    for relative, kind in KINDS.items():
        path = out / relative
        if kind in kinds and path.is_file():
            files.append({"path": relative, "sha256": sha256_file(path), "bytes": path.stat().st_size, "kind": kind})
    for kind in required:
        if not any(entry["kind"] == kind for entry in files):
            raise JobError(f"the job produced no {kind} file")
    return files


def write_peft_manifest(job: dict, out: Path, result: dict) -> dict:
    """outputs/peft-manifest.json: the trained PEFT adapter and the log, hashed, before conversion."""
    manifest = {
        "format": PEFT_FORMAT,
        "job_id": job["job_id"],
        "base_model": job["base_model"],
        "dataset": {"sha256": job["dataset"]["sha256"], "trained_examples": result["trained_examples"]},
        "recipe": job["recipe"],
        "lora": {"r": job["lora"]["r"], "alpha": job["lora"]["alpha"], "target_modules": job["lora"]["target_modules"]},
        "metrics": {
            "steps": result["steps"],
            "loss_first": result["loss_first"],
            "loss_last": result["loss_last"],
            "train_seconds": result["train_seconds"],
        },
        "files": file_entries(out, ("peft_config", "peft_weights"), ("peft_config", "peft_weights", "log")),
    }
    (out / "peft-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    return manifest


def write_manifest(job: dict, out: Path, result: dict, convert_seconds: float) -> dict:
    files = file_entries(out, ("peft_config", "peft_weights", "gguf_lora"))
    manifest = {
        "format": OUTPUT_FORMAT,
        "job_id": job["job_id"],
        "stand_in": False,
        "base_model": job["base_model"],
        "dataset": {
            "sha256": job["dataset"]["sha256"],
            "example_count": job["dataset"]["example_count"],
            "trained_examples": result["trained_examples"],
            "trained_tokens": result["trained_tokens"],
            "skipped": result["skipped"],
        },
        "recipe": job["recipe"],
        "lora": {"r": job["lora"]["r"], "alpha": job["lora"]["alpha"], "target_modules": job["lora"]["target_modules"]},
        "converter": {"commit": job["converter"]["commit"], "outtype": job["converter"]["outtype"]},
        "versions": versions(),
        "metrics": {
            "steps": result["steps"],
            "loss_first": result["loss_first"],
            "loss_last": result["loss_last"],
            "train_seconds": result["train_seconds"],
            "convert_seconds": convert_seconds,
            "stopped_early": result["stopped_early"],
        },
        "files": files,
    }
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    return manifest


def upload(out: Path, paths: list, message: str) -> None:
    from huggingface_hub import HfApi

    repo = os.environ["ARCHITECT_REPO"]
    HfApi().upload_folder(
        repo_id=repo,
        folder_path=str(out),
        path_in_repo="outputs",
        allow_patterns=paths,
        commit_message=message,
    )
    log(f"Uploaded {len(paths)} files to {repo}/outputs")


def finish(job: dict, out: Path, work: Path, result: dict, send: bool, convert_fn=None, upload_fn=None) -> dict:
    """After training: the PEFT adapter hashed and, with ``send``, uploaded before anything can fail
    in conversion; then the GGUF conversion, the manifest of every file, and its upload."""
    convert_fn = convert_fn or convert
    upload_fn = upload_fn or upload
    peft = write_peft_manifest(job, out, result)
    if send:
        upload_fn(
            out,
            [entry["path"] for entry in peft["files"]] + ["peft-manifest.json"],
            f"Trained PEFT adapter of job {job['job_id']}, before conversion",
        )
    convert_seconds = convert_fn(job, result["base_dir"], out / "peft", out / "adapter.gguf", work)
    manifest = write_manifest(job, out, result, convert_seconds)
    if send:
        upload_fn(out, ["adapter.gguf", "manifest.json"], f"Outputs of training job {job['job_id']}")
    return manifest


def main(argv: list) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--job", type=Path, required=True)
    parser.add_argument("--inputs", type=Path, required=True)
    parser.add_argument("--out", type=Path)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--upload", action="store_true")
    args = parser.parse_args(argv)
    started = time.monotonic()
    try:
        job, _recipe, examples = load(args.job, args.inputs)
    except (JobError, KeyError, TypeError, ValueError) as error:
        print(json.dumps({"ok": False, "error": str(error)}))
        return 2
    if args.dry_run:
        print(json.dumps(summary(job, examples)))
        return 0
    if args.out is None:
        parser.error("--out is required unless --dry-run is given")
    out = args.out
    out.mkdir(parents=True, exist_ok=True)
    work = out.parent / "work"
    work.mkdir(parents=True, exist_ok=True)

    log(f"Job {job['job_id']}: {len(examples)} examples on {job['base_model']['repo']}")
    install(job["python_packages"])
    import train_qlora

    deadline = started + job["max_seconds"] - RESERVE_SECONDS
    with (out / "train.log").open("a", encoding="utf-8") as log_file:
        def note(message: str) -> None:
            log(message)
            log_file.write(message + "\n")

        result = train_qlora.train(job, examples, out / "peft", deadline, note)
    finish(job, out, work, result, args.upload)
    log("Done")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
