"""EXPERIMENTAL, NOT RUN. A distributed LoRA, QLoRA or full fine-tune of a causal language model.

This script has never run on a GPU or a cluster. Architect checks that it compiles and that the
bundles around it are well formed; GPU execution, large-model compatibility and training gains
remain unverified. The pinned single-GPU recipe (pipeline.py, train_qlora.py) is separate and
unchanged.

It is started once per GPU by torchrun (an sbatch script or a PyTorchJob that Architect writes)
and reads train.json beside it: the base model at a fixed revision, the method, the LoRA settings
and the training settings. Data is a field export's verified demonstrations (sft/*.jsonl, copied
into the bundle's data/ folder), one chat example per line. Labels cover only assistant turns;
a turn with no train flag counts as one to train on. FSDP shards the model across every GPU by
decoder layer, with the settings in fsdp_config.json. LoRA targets attention and every MLP or
expert projection; experts a model fuses into one tensor are targeted as parameters.

    torchrun --nproc_per_node=8 train_fsdp.py --config train.json
"""

from __future__ import annotations

import argparse
import glob
import json
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import chat_spans  # noqa: E402

IGNORE = -100
FUSED_EXPERT_PARAMETERS = ("experts.gate_up_proj", "experts.down_proj")


def rank() -> int:
    return int(os.environ.get("RANK", "0"))


def log(message: str) -> None:
    if rank() == 0:
        print(f"[architect] {message}", flush=True)


def as_trainable(example: dict) -> dict:
    """The example with every message flagged: assistant turns train unless they say otherwise."""
    messages = []
    for message in example["messages"]:
        flagged = dict(message)
        flagged["train"] = bool(message.get("train", message.get("role") == "assistant"))
        flagged.setdefault("content", "")
        messages.append(flagged)
    return {**example, "messages": messages}


def load_examples(pattern: str) -> list:
    examples = []
    for path in sorted(glob.glob(pattern)):
        with open(path, encoding="utf-8") as handle:
            for number, line in enumerate(handle, start=1):
                if line.strip():
                    example = json.loads(line)
                    example.setdefault("id", f"{Path(path).name}:{number}")
                    examples.append(as_trainable(example))
    if not examples:
        raise SystemExit(f"No examples in {pattern}")
    return examples


def encode(tokenizer, example: dict, max_len: int):
    tools = example.get("tools") or None
    kwargs = example.get("chat_template_kwargs") or {}

    def render(messages, add_generation_prompt):
        text = tokenizer.apply_chat_template(
            messages, tools=tools, tokenize=False, add_generation_prompt=add_generation_prompt, **kwargs
        )
        if not isinstance(text, str):
            raise chat_spans.ExampleError("the chat template did not return text")
        return text

    full, spans = chat_spans.trainable_char_spans(render, example["messages"])
    encoded = tokenizer(full, add_special_tokens=False, return_offsets_mapping=True)
    ids = list(encoded["input_ids"])
    if len(ids) > max_len:
        raise chat_spans.ExampleError(f"it is {len(ids)} tokens, more than the limit of {max_len}")
    mask = chat_spans.token_mask(encoded["offset_mapping"], spans)
    labels = [token if target else IGNORE for token, target in zip(ids, mask)]
    if all(label == IGNORE for label in labels):
        raise chat_spans.ExampleError("no token of it is a target")
    return ids, labels


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--config", required=True)
    args = parser.parse_args()
    config_path = Path(args.config).resolve()
    settings = json.loads(config_path.read_text(encoding="utf-8"))
    here = config_path.parent

    import torch
    from transformers import (
        AutoModelForCausalLM,
        AutoTokenizer,
        BitsAndBytesConfig,
        Trainer,
        TrainingArguments,
        set_seed,
    )

    training = settings["training"]
    method = settings["method"]
    dtype = {"bf16": torch.bfloat16, "fp16": torch.float16, "fp32": torch.float32}[settings["precision"]]
    set_seed(training["seed"])
    output_dir = Path(os.environ.get("ARCHITECT_OUTPUT_DIR", here / settings["output_dir"]))

    # TrainingArguments come first: with FSDP they set how the model is loaded (rank 0 reads the
    # weights, the others start empty and receive their shards).
    arguments = TrainingArguments(
        output_dir=str(output_dir / "trainer-state"),
        per_device_train_batch_size=training["per_device_batch_size"],
        gradient_accumulation_steps=training["gradient_accumulation_steps"],
        num_train_epochs=training["epochs"],
        learning_rate=training["learning_rate"],
        lr_scheduler_type=training["lr_scheduler"],
        warmup_steps=training["warmup_steps"],
        gradient_checkpointing=True,
        gradient_checkpointing_kwargs={"use_reentrant": False},
        fsdp="full_shard auto_wrap",
        fsdp_config=str(here / settings["fsdp_config"]),
        bf16=settings["precision"] == "bf16",
        fp16=settings["precision"] == "fp16",
        logging_steps=1,
        save_strategy="no",
        report_to=[],
        seed=training["seed"],
        remove_unused_columns=False,
        ddp_timeout=3600,
    )

    base = settings["base_model"]
    log(f"Loading {base['repo']} at {base['revision']} for {method}")
    tokenizer = AutoTokenizer.from_pretrained(base["repo"], revision=base["revision"])
    examples = load_examples(str(here / settings["data"]))
    features, skipped = [], []
    for example in examples:
        try:
            ids, labels = encode(tokenizer, example, training["max_seq_len"])
        except chat_spans.ExampleError as error:
            skipped.append({"id": example["id"], "reason": str(error)})
            continue
        features.append({"input_ids": ids, "labels": labels})
    if not features:
        raise SystemExit("No example could be trained on: " + "; ".join(s["reason"] for s in skipped))
    log(f"{len(features)} examples, {len(skipped)} skipped")

    quantization = None
    if method == "qlora":
        # FSDP shards the 4-bit weights as stored, so they are stored in the compute dtype.
        quantization = BitsAndBytesConfig(
            load_in_4bit=True,
            bnb_4bit_quant_type="nf4",
            bnb_4bit_use_double_quant=True,
            bnb_4bit_compute_dtype=dtype,
            bnb_4bit_quant_storage=dtype,
        )
    model = AutoModelForCausalLM.from_pretrained(
        base["repo"],
        revision=base["revision"],
        dtype=dtype,
        quantization_config=quantization,
        low_cpu_mem_usage=True,
    )
    model.config.use_cache = False

    if method in ("lora", "qlora"):
        from peft import LoraConfig, get_peft_model

        lora = settings["lora"]
        names = {name for name, _ in model.named_parameters()}
        fused = sorted({suffix for suffix in FUSED_EXPERT_PARAMETERS for name in names if name.endswith(suffix)})
        model.enable_input_require_grads()
        model = get_peft_model(
            model,
            LoraConfig(
                r=lora["r"],
                lora_alpha=lora["alpha"],
                lora_dropout=lora["dropout"],
                target_modules=lora["target_modules"],
                target_parameters=fused or None,
                bias="none",
                task_type="CAUSAL_LM",
            ),
        )
        adapted = [name for name, module in model.named_modules() if hasattr(module, "lora_A")]
        experts = [name for name in adapted if ".experts." in name or name.endswith(".experts")]
        log(f"LoRA on {len(adapted)} modules, {len(experts)} of them experts; fused expert tensors: {fused or 'none'}")
        if not adapted:
            raise SystemExit("LoRA matched no module; check target_modules against the model's names.")

    pad = tokenizer.pad_token_id if tokenizer.pad_token_id is not None else tokenizer.eos_token_id

    class Examples(torch.utils.data.Dataset):
        def __len__(self):
            return len(features)

        def __getitem__(self, index):
            return features[index]

    def collate(batch):
        width = max(len(item["input_ids"]) for item in batch)
        ids = [item["input_ids"] + [pad] * (width - len(item["input_ids"])) for item in batch]
        labels = [item["labels"] + [IGNORE] * (width - len(item["labels"])) for item in batch]
        mask = [[1] * len(item["input_ids"]) + [0] * (width - len(item["input_ids"])) for item in batch]
        return {
            "input_ids": torch.tensor(ids),
            "labels": torch.tensor(labels),
            "attention_mask": torch.tensor(mask),
        }

    started = time.monotonic()
    trainer = Trainer(model=model, args=arguments, train_dataset=Examples(), data_collator=collate)
    trainer.train()
    if trainer.is_fsdp_enabled:
        trainer.accelerator.state.fsdp_plugin.set_state_dict_type("FULL_STATE_DICT")
    trainer.save_model(str(output_dir / "model"))
    if rank() == 0:
        (output_dir / "result.json").write_text(
            json.dumps(
                {
                    "experimental": True,
                    "base_model": base,
                    "method": method,
                    "field_export": settings.get("field_export"),
                    "steps": trainer.state.global_step,
                    "trained_examples": len(features),
                    "skipped": skipped,
                    "train_seconds": round(time.monotonic() - started, 1),
                },
                indent=2,
            ),
            encoding="utf-8",
        )
    log(f"Saved to {output_dir / 'model'}")


if __name__ == "__main__":
    main()
