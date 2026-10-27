# Models

Verified facts about the models Architect uses, with sources. Model ids appear in code only in `packages/shared/src/models.ts`, which mirrors this page. Last checked: 2026-10-27.

## Roles

| Role in Architect | Model | Where it runs | Id |
| --- | --- | --- | --- |
| Mentor (default) | Muse Spark 1.3 | Meta Model API | `muse-spark-1.3` |
| Mentor (cheaper, data may train Meta's models) | Muse Spark 1.3, contributor tier | Meta Model API | `muse-spark-1.3-contributor` |
| Mentor (self-hosted option) | Muse Spark Open | Baseten or Modal | Baseten: `meta-models/muse-spark-open-1026` |
| Student (default) | Muse Glimmer 30B | Ollama on this computer | `muse-glimmer:30b` |

## Meta Model API

- Base URL `https://api.meta.ai/v1`, OpenAI-compatible (Chat Completions and Responses), Bearer token auth. The docs name the key `MODEL_API_KEY`; the OpenAI SDK does not read it automatically, so the adapter passes it explicitly. Sources: https://dev.meta.ai/docs/quickstart, https://dev.meta.ai/docs/models
- `GET /v1/models` (checked with a real key on 2026-10-27) lists `muse-wonder-1.0`, `sam-3.1`, `muse-spark-1.3-contributor`, `muse-voice-transcribe-1.0`, `muse-spark-1.3`, `muse-image-1.0`, `muse-spark-1.2-contributor`, `muse-spark-1.2`, `muse-spark-1.1`.
- Muse Spark 1.3: 1,048,576-token context, 131,072 max output tokens, text, image, video, audio and PDF in, text out, tool calling and structured output. Reasoning effort levels up to `max`; the contributor tier supports every level except `max`.
- Contributor tier: lower price in exchange for letting Meta use the content for training. Architect defaults to the private tier and shows the tier as a setting with that explanation.
- Checked request: `POST /v1/chat/completions` with `model: muse-spark-1.3`, one function tool, `reasoning_effort: "low"`, `max_completion_tokens: 400` returned a tool call. Usage reports `prompt_tokens`, `completion_tokens`, `completion_tokens_details.reasoning_tokens` and `prompt_tokens_details.cached_tokens`. Reasoning tokens count as output.

## Muse Spark Open

- Open-weight sibling of Muse Spark: about 816B parameters, mixture of experts with about 42B active (from the model slugs on https://dev.meta.ai/models/muse-spark-open). Too large for a desktop; Architect reaches it on a hosted GPU platform.
- Baseten: use the model id `meta-models/muse-spark-open-1026`, not the `meta-models/muse-spark-open` shown in Baseten's general docs.

## Muse Glimmer

- 30B dense model with a vision encoder, Apache 2.0. Hugging Face `meta-models/Muse-Glimmer-30B`; text config has 52 layers, hidden size 6656, 32 attention heads with 2 key-value heads, a 2048-token sliding window on three of every four layers, and 131,072 positions. Source: https://huggingface.co/meta-models/Muse-Glimmer-30B
- Ollama tags (https://ollama.com/library/muse-glimmer): `muse-glimmer:30b` and `muse-glimmer:latest` (18 GB), `muse-glimmer:30b-mlx` (19 GB, Apple silicon); 128K context; supports tools and thinking.
