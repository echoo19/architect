"""Which tokens of a chat example are training targets.

Only assistant messages flagged ``train`` are targets: everything the model would produce for
that turn, from just after the generation prompt through the token that ends the turn. The span
of each target is found by rendering the conversation with the model's own chat template up to
that turn, so no knowledge of the template's format is coded here. A template that renders a
turn differently inside the whole conversation than at its end is refused rather than guessed
at, since a wrong guess would train on the wrong tokens.

Standard library only, so the dry run and the self test run anywhere.
"""

from __future__ import annotations

from typing import Callable, Sequence

EXAMPLE_FORMAT = "architect.chat-example/1"

Render = Callable[[list, bool], str]


class ExampleError(ValueError):
    """An example that can't be trained on as it stands."""


def _check(condition: bool, message: str) -> None:
    if not condition:
        raise ExampleError(message)


def validate_example(example: dict) -> int:
    """Checks one example's structure and returns how many turns it trains on."""
    _check(example.get("format") == EXAMPLE_FORMAT, f"format is not {EXAMPLE_FORMAT}")
    messages = example.get("messages")
    _check(isinstance(messages, list) and len(messages) >= 2, "it needs at least two messages")
    tools = {tool["function"]["name"] for tool in example.get("tools", [])}
    open_calls: set = set()
    trained = 0
    previous = None
    for index, message in enumerate(messages):
        role = message.get("role")
        _check(role in ("system", "user", "assistant", "tool"), f"message {index} has role {role!r}")
        _check(isinstance(message.get("train"), bool), f"message {index} has no train flag")
        _check(isinstance(message.get("content"), str), f"message {index} has no text")
        if role != "assistant":
            _check(not message["train"], f"message {index} is a {role} message flagged for training")
        if role == "assistant":
            _check(not open_calls, f"the tool calls before message {index} were never answered")
            _check(previous != "assistant", f"messages {index - 1} and {index} are both the assistant's")
            calls = message.get("tool_calls") or []
            for call in calls:
                function = call.get("function", {})
                _check(function.get("name") in tools, f"message {index} calls a tool that was not offered")
                _check(isinstance(function.get("arguments"), dict), f"message {index} has arguments that are not an object")
                _check(call.get("id") not in open_calls, f"message {index} uses a call id twice")
                open_calls.add(call.get("id"))
            if message["train"]:
                _check(bool(message["content"].strip()) or bool(calls), f"message {index} is an empty target")
                trained += 1
        elif role == "tool":
            _check(message.get("tool_call_id") in open_calls, f"message {index} answers a call that was not made")
            open_calls.discard(message.get("tool_call_id"))
        else:
            _check(not open_calls, f"the tool calls before message {index} were never answered")
        previous = role
    _check(not open_calls, "the last tool calls were never answered")
    _check(trained > 0, "no turn is flagged for training")
    return trained


def plain_messages(messages: Sequence[dict]) -> list:
    """The messages as a chat template takes them, without the train flags."""
    return [{key: value for key, value in message.items() if key != "train"} for message in messages]


def trainable_char_spans(render: Render, messages: Sequence[dict]) -> tuple:
    """Renders the conversation and returns (text, [(start, end), ...]) for every target turn.

    ``render(messages, add_generation_prompt)`` must return the template's text.
    """
    plain = plain_messages(messages)
    full = render(plain, False)
    spans = []
    for index, message in enumerate(messages):
        if message.get("role") != "assistant" or not message.get("train"):
            continue
        before = render(plain[:index], True)
        through = render(plain[: index + 1], False)
        if not through.startswith(before):
            raise ExampleError(f"message {index}: the template does not continue the text before it")
        if not full.startswith(through):
            raise ExampleError(f"message {index}: the template renders it differently inside the whole conversation")
        if len(through) == len(before):
            raise ExampleError(f"message {index}: the template renders it as nothing")
        spans.append((len(before), len(through)))
    return full, spans


def token_mask(offsets: Sequence[Sequence[int]], spans: Sequence[Sequence[int]]) -> list:
    """For each token's (start, end) characters, whether it lies wholly inside a target span.

    A token that straddles a span's edge is not a target: it belongs partly to the context.
    """
    mask = []
    for start, end in offsets:
        mask.append(end > start and any(start >= low and end <= high for low, high in spans))
    return mask
