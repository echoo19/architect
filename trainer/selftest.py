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


if __name__ == "__main__":
    unittest.main()
