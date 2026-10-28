"""QLoRA training on verified chat examples, for the job file pipeline.py checked.

The base model loads in 4-bit (bitsandbytes NF4); LoRA adapts the text decoder's linear layers
only, never the vision tower, the embeddings or the output head, so llama.cpp's converter can map
every adapted weight onto the GGUF base. Scaling is plain alpha / r, the way llama.cpp applies
it. Labels cover only the assistant turns the example flags for training (chat_spans.py). An
example longer than the job's limit is listed as skipped, never cut short.

Heavy imports happen inside train(), after pipeline.py has installed the pinned packages.
"""

from __future__ import annotations

import time
from pathlib import Path

import chat_spans

IGNORE = -100


def encode(tokenizer, example: dict, max_len: int):
    """Token ids and labels for one example; labels are IGNORE outside its target turns."""
    tools = example["tools"]
    kwargs = example["chat_template_kwargs"]

    def render(messages, add_generation_prompt):
        text = tokenizer.apply_chat_template(
            messages,
            tools=tools,
            tokenize=False,
            add_generation_prompt=add_generation_prompt,
            **kwargs,
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


def train(job: dict, examples: list, peft_dir: Path, deadline: float, log) -> dict:
    import torch
    from huggingface_hub import snapshot_download
    from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training
    from transformers import (
        AutoModelForImageTextToText,
        AutoTokenizer,
        BitsAndBytesConfig,
        Trainer,
        TrainerCallback,
        TrainingArguments,
        set_seed,
    )

    settings = job["training"]
    lora = job["lora"]
    quant = job["quantization"]
    set_seed(settings["seed"])
    started = time.monotonic()

    base = job["base_model"]
    log(f"Downloading {base['repo']} at {base['revision']}")
    base_dir = snapshot_download(
        repo_id=base["repo"],
        revision=base["revision"],
        allow_patterns=["*.json", "*.safetensors", "*.jinja", "*.txt", "tokenizer*"],
    )
    tokenizer = AutoTokenizer.from_pretrained(base_dir)

    features, skipped, trained_tokens = [], [], 0
    for example in examples:
        try:
            ids, labels = encode(tokenizer, example, settings["max_seq_len"])
        except chat_spans.ExampleError as error:
            skipped.append({"id": example["id"], "reason": str(error)})
            continue
        trained_tokens += sum(1 for label in labels if label != IGNORE)
        features.append({"input_ids": ids, "labels": labels})
    if not features:
        raise RuntimeError("No example could be trained on: " + "; ".join(s["reason"] for s in skipped))
    log(f"{len(features)} examples, {trained_tokens} target tokens, {len(skipped)} skipped")

    dtype = getattr(torch, quant["compute_dtype"])
    model = AutoModelForImageTextToText.from_pretrained(
        base_dir,
        quantization_config=BitsAndBytesConfig(
            load_in_4bit=True,
            bnb_4bit_quant_type=quant["quant_type"],
            bnb_4bit_use_double_quant=quant["double_quant"],
            bnb_4bit_compute_dtype=dtype,
        ),
        dtype=dtype,
        device_map={"": 0},
    )
    model = prepare_model_for_kbit_training(
        model, use_gradient_checkpointing=settings["gradient_checkpointing"]
    )
    model = get_peft_model(
        model,
        LoraConfig(
            r=lora["r"],
            lora_alpha=lora["alpha"],
            lora_dropout=lora["dropout"],
            target_modules=lora["target_modules"],
            use_rslora=lora["use_rslora"],
            use_dora=lora["use_dora"],
            bias="none",
            task_type="CAUSAL_LM",
        ),
    )
    adapted = [name for name, module in model.named_modules() if hasattr(module, "lora_A")]
    if not adapted or any("vision" in name for name in adapted):
        raise RuntimeError(f"LoRA landed on {len(adapted)} modules, or on the vision tower")
    log(f"LoRA on {len(adapted)} modules")

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

    losses = []
    stopped = {"early": False}

    class Watch(TrainerCallback):
        def on_log(self, args, state, control, logs=None, **kwargs):
            if logs and "loss" in logs:
                losses.append(float(logs["loss"]))

        def on_step_end(self, args, state, control, **kwargs):
            if time.monotonic() >= deadline:
                stopped["early"] = True
                control.should_training_stop = True
            return control

    output = peft_dir.parent / "trainer-state"
    trainer = Trainer(
        model=model,
        args=TrainingArguments(
            output_dir=str(output),
            per_device_train_batch_size=settings["per_device_batch_size"],
            gradient_accumulation_steps=settings["gradient_accumulation_steps"],
            num_train_epochs=settings["epochs"],
            learning_rate=settings["learning_rate"],
            lr_scheduler_type=settings["lr_scheduler"],
            warmup_steps=settings["warmup_steps"],
            optim=settings["optimizer"],
            gradient_checkpointing=settings["gradient_checkpointing"],
            bf16=quant["compute_dtype"] == "bfloat16",
            fp16=quant["compute_dtype"] == "float16",
            logging_steps=1,
            save_strategy="no",
            report_to=[],
            seed=settings["seed"],
            remove_unused_columns=False,
        ),
        train_dataset=Examples(),
        data_collator=collate,
        callbacks=[Watch()],
    )
    trainer.train()
    peft_dir.mkdir(parents=True, exist_ok=True)
    model.save_pretrained(str(peft_dir))
    return {
        "base_dir": base_dir,
        "steps": trainer.state.global_step,
        "loss_first": losses[0] if losses else None,
        "loss_last": losses[-1] if losses else None,
        "trained_examples": len(features),
        "trained_tokens": trained_tokens,
        "skipped": skipped,
        "stopped_early": stopped["early"],
        "train_seconds": round(time.monotonic() - started, 1),
    }
