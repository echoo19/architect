#!/usr/bin/env python3
"""Checks chat_spans.py without a model: python selftest.py

A small renderer in Muse Glimmer's shape (turns opened by <|start|>, a recipient on assistant
turns, tool calls as <atem:...> blocks, <|eot|> or <|eom|> to close) stands in for the real
template, so the tests can say exactly which characters are targets.
"""

from __future__ import annotations

import json
import unittest

import chat_spans
import pipeline


def glimmer_like(messages: list, add_generation_prompt: bool) -> str:
    text = "<|begin|>"
    for index, message in enumerate(messages):
        role = message["role"]
        following = messages[index + 1]["role"] if index + 1 < len(messages) else None
        end = "<|eom|>" if following == role else "<|eot|>"
        if role == "assistant":
            if message.get("reasoning_content"):
                text += f"<|start|>assistant to=self<|message|>{message['reasoning_content']}<|eom|>"
            calls = message.get("tool_calls") or []
            for position, call in enumerate(calls):
                arguments = json.dumps(call["function"]["arguments"], sort_keys=True)
                close = end if position == len(calls) - 1 else "<|eom|>"
                text += f"<|start|>assistant to={call['function']['name']}<|message|><atem:{arguments}>{close}"
            if not calls:
                text += f"<|start|>assistant to=user<|message|>{message['content']}{end}"
        elif role == "tool":
            text += f"<|start|>tool {message['name']}<|message|>{message['content']}<|eot|>"
        else:
            text += f"<|start|>{role}<|message|>{message['content']}<|eot|>"
    if add_generation_prompt:
        text += "<|start|>assistant"
    return text


def example(messages: list) -> dict:
    return {
        "format": chat_spans.EXAMPLE_FORMAT,
        "id": "ex-1",
        "messages": messages,
        "tools": [{"type": "function", "function": {"name": "read", "description": "", "parameters": {"type": "object"}}}],
        "chat_template_kwargs": {"reasoning_strength": "low"},
    }


CALL = {"id": "call_1", "type": "function", "function": {"name": "read", "arguments": {"path": "data/orders.csv"}}}
CONVERSATION = [
    {"role": "system", "content": "You are the returns desk.", "train": False},
    {"role": "user", "content": "Is order 1182 late?", "train": False},
    {"role": "assistant", "content": "", "tool_calls": [CALL], "train": False},
    {"role": "tool", "tool_call_id": "call_1", "name": "read", "content": "order,shipped\n1182,2026-11-20", "train": False},
    {"role": "assistant", "content": "ANSWER: {\"late\": false}", "reasoning_content": "Shipped on time.", "train": True},
]


class Spans(unittest.TestCase):
    def test_targets_only_the_flagged_turn_through_its_end_token(self):
        full, spans = chat_spans.trainable_char_spans(glimmer_like, CONVERSATION)
        self.assertEqual(len(spans), 1)
        start, end = spans[0]
        self.assertEqual(
            full[start:end],
            ' to=self<|message|>Shipped on time.<|eom|><|start|>assistant to=user<|message|>ANSWER: {"late": false}<|eot|>',
        )
        self.assertTrue(full[:start].endswith("<|start|>assistant"))
        self.assertNotIn("1182,2026-11-20", full[start:end])

    def test_a_tool_call_turn_is_a_target_when_flagged(self):
        messages = [dict(message) for message in CONVERSATION]
        messages[2]["train"] = True
        _, spans = chat_spans.trainable_char_spans(glimmer_like, messages)
        self.assertEqual(len(spans), 2)

    def test_a_template_that_renders_a_turn_differently_later_is_refused(self):
        def unstable(messages, add_generation_prompt):
            return glimmer_like(messages, add_generation_prompt).replace("<|eot|>", "<|end|>", 1) if len(messages) == len(CONVERSATION) else glimmer_like(messages, add_generation_prompt)

        with self.assertRaises(chat_spans.ExampleError):
            chat_spans.trainable_char_spans(unstable, CONVERSATION)

    def test_tokens_that_straddle_an_edge_are_context(self):
        spans = [(10, 20)]
        self.assertEqual(
            chat_spans.token_mask([(0, 10), (8, 12), (10, 15), (15, 20), (19, 21), (20, 20)], spans),
            [False, False, True, True, False, False],
        )


class Examples(unittest.TestCase):
    def test_a_well_formed_example_counts_its_targets(self):
        self.assertEqual(chat_spans.validate_example(example(CONVERSATION)), 1)

    def test_flawed_examples_are_refused(self):
        def refused(messages):
            with self.assertRaises(chat_spans.ExampleError):
                chat_spans.validate_example(example(messages))

        trained_user = [dict(message) for message in CONVERSATION]
        trained_user[1]["train"] = True
        refused(trained_user)
        refused(CONVERSATION[:3])
        refused(CONVERSATION[:2] + CONVERSATION[3:])
        no_target = [dict(message, train=False) for message in CONVERSATION]
        refused(no_target)
        string_arguments = [dict(message) for message in CONVERSATION]
        string_arguments[2] = dict(string_arguments[2], tool_calls=[dict(CALL, function={"name": "read", "arguments": "{}"})])
        refused(string_arguments)


class SystemPackages(unittest.TestCase):
    def test_the_image_as_it_is_needs_git_and_the_venv_module(self):
        self.assertEqual(
            pipeline.system_packages(False, False, (3, 12, 3)),
            ["git", "ca-certificates", "python3.12-venv"],
        )

    def test_nothing_is_installed_that_is_already_there(self):
        self.assertEqual(pipeline.system_packages(True, True, (3, 12, 3)), [])
        self.assertEqual(pipeline.system_packages(True, False, (3, 13, 0)), ["python3.13-venv"])


class Finish(unittest.TestCase):
    """The trained adapter is hashed and uploaded before conversion, so a failed one loses nothing."""

    JOB = {
        "job_id": "trn_test",
        "base_model": {"repo": "meta-models/Muse-Glimmer-30B", "revision": "c" * 40},
        "dataset": {"sha256": "d" * 64, "example_count": 2},
        "recipe": {"name": "glimmer-qlora", "version": 1, "sha256": "e" * 64},
        "lora": {"r": 16, "alpha": 32, "target_modules": "v_proj"},
        "converter": {"commit": "f" * 40, "outtype": "f16"},
    }
    RESULT = {
        "base_dir": "/base", "steps": 6, "loss_first": 0.1, "loss_last": 0.01, "train_seconds": 295.0,
        "trained_examples": 2, "trained_tokens": 40, "skipped": [], "stopped_early": False,
    }

    def setUp(self):
        import tempfile
        from pathlib import Path

        self.dir = tempfile.TemporaryDirectory()
        self.out = Path(self.dir.name) / "outputs"
        (self.out / "peft").mkdir(parents=True)
        (self.out / "peft" / "adapter_config.json").write_text('{"r": 16}')
        (self.out / "peft" / "adapter_model.safetensors").write_bytes(b"weights")
        (self.out / "train.log").write_text("step 1: loss 0.1000\n")
        self.uploads = []

    def tearDown(self):
        self.dir.cleanup()

    def upload(self, out, paths, message):
        self.uploads.append((list(paths), message))

    def test_a_failed_conversion_keeps_the_trained_adapter_uploaded_and_hashed(self):
        def broken(*args):
            raise RuntimeError("AttributeError: 'LoraTorchTensor' object has no attribute 'ndim'")

        with self.assertRaises(RuntimeError):
            pipeline.finish(self.JOB, self.out, self.out.parent / "work", self.RESULT, True, broken, self.upload)
        self.assertEqual(len(self.uploads), 1)
        paths, message = self.uploads[0]
        self.assertEqual(
            paths,
            ["peft/adapter_config.json", "peft/adapter_model.safetensors", "train.log", "peft-manifest.json"],
        )
        self.assertIn("before conversion", message)
        manifest = json.loads((self.out / "peft-manifest.json").read_text())
        self.assertEqual(manifest["format"], pipeline.PEFT_FORMAT)
        weights = next(entry for entry in manifest["files"] if entry["kind"] == "peft_weights")
        self.assertEqual(weights["sha256"], pipeline.sha256_file(self.out / "peft" / "adapter_model.safetensors"))
        self.assertFalse((self.out / "manifest.json").exists())

    def test_a_good_conversion_adds_the_gguf_and_a_manifest_of_both(self):
        def convert(job, base, peft, gguf, work):
            gguf.write_bytes(b"GGUF")
            return 12.5

        manifest = pipeline.finish(self.JOB, self.out, self.out.parent / "work", self.RESULT, True, convert, self.upload)
        self.assertEqual([paths for paths, _ in self.uploads][1], ["adapter.gguf", "manifest.json"])
        kinds = {entry["kind"] for entry in manifest["files"]}
        self.assertTrue({"peft_config", "peft_weights", "gguf_lora", "log"} <= kinds)

    def test_nothing_is_sent_without_the_trained_weights(self):
        (self.out / "peft" / "adapter_model.safetensors").unlink()
        with self.assertRaises(pipeline.JobError):
            pipeline.finish(self.JOB, self.out, self.out.parent / "work", self.RESULT, True, None, self.upload)
        self.assertEqual(self.uploads, [])


if __name__ == "__main__":
    unittest.main()
