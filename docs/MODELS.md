# Models

Verified facts about the models Architect uses, with sources. Model ids appear in code only in `packages/shared/src/models.ts`, which mirrors this page. Last checked: 2026-10-28 for the mentors beyond Meta, the connections and the GPU-sized Glimmer build; 2026-10-27 for the rest.

How to read this page:

- Each fact has a source URL next to it. "Unverified" means no public source confirmed it on the check date.
- "Owner-checked" means the project owner made the call with a real key.
- Prices are US dollars per million tokens, written input / cached input / output.
- No key values appear on this page.
- Muse Spark Open shipped on 2026-10-15 and Muse Glimmer in August 2026, so provider pages are still changing. Recheck any number that decides spend.

## Summary

| Role in Architect | Provider | Exact id | Endpoint | Context | Price in / cached / out |
| --- | --- | --- | --- | --- | --- |
| Mentor, default | Meta Model API | `muse-spark-1.3` | `https://api.meta.ai/v1` | 1,048,576; 131,072 max output (OpenCode example) | $1.25 / $0.15 / $4.25 |
| Mentor, cheaper (Meta may train on the content) | Meta Model API | `muse-spark-1.3-contributor` | `https://api.meta.ai/v1` | 1,048,576 | $0.10 / $0.002 / $0.20 |
| Mentor, open weights, hosted | Baseten Model APIs | `meta-models/muse-spark-open-1026` (dated snapshot from Baseten's partner notes; public pages show `meta-models/muse-spark-open`) | `https://inference.baseten.co/v1` | 1,048,576 for the model; Baseten's served limit unverified | $1.25 / $0.15 / $4.25 |
| Mentor, open weights, hosted | Modal Shared Endpoint | endpoint created from `meta-models/Muse-Spark-Open-816B-A42B`; request `model` comes from the dashboard | `https://inference.us-west.modal.direct/v1` (confirm in the dashboard) | 1,000,000 | $1.25 / $0.15 / $4.25 |
| Mentor, other providers | OpenAI | `gpt-6.1-sol`, `gpt-6-luna` | `https://api.openai.com/v1` | not recorded | $2 / $0.10 / $10 and $0.10 / $0.01 / $0.50, more above 272K input tokens |
| Mentor, other providers | Anthropic | `claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5` | `https://api.anthropic.com/v1` | read from `GET /v1/models` | $4 / $0.20 / $20, $2 / $0.10 / $10, $0.10 / $0.01 / $0.50 (Haiku more above 100K) |
| Mentor, other providers | Google Gemini, OpenAI-compatible endpoint | `gemini-3.1-pro-preview`, `gemini-3.5-flash-lite` | `https://generativelanguage.googleapis.com/v1beta/openai` | not recorded | $2 / $0.20 / $12 (more above 200K) and $0.30 / $0.03 / $2.50 |
| Mentor, any of its models | OpenRouter | any id from `GET /models` | `https://openrouter.ai/api/v1` | listed per model | listed per model, saved with the mentor |
| Mentor, on this computer | Ollama or LM Studio | any installed model | `http://127.0.0.1:11434` (`/v1` added) or `http://127.0.0.1:1234/v1` | per model | free |
| Student, default | Ollama on this computer | `muse-glimmer:30b` | `http://127.0.0.1:11434` | tags say 128K; Ollama loads 4k by default under 24 GiB VRAM | local |
| Student, fits a 12 GB GPU | Ollama, a text-only model Architect makes from a 2-bit GGUF | `muse-glimmer:30b-iq2`, from `unsloth/Muse-Glimmer-30B-GGUF` file `Muse-Glimmer-30B-UD-IQ2_XXS.gguf` (10.7 GB) | `http://127.0.0.1:11434` | 131,072; Architect asks for 16,384 | local |
| Student, fits a 12 GB GPU, by hand | llama.cpp with the same GGUF | `unsloth/Muse-Glimmer-30B-GGUF`, file `Muse-Glimmer-30B-UD-IQ2_XXS.gguf` (10.7 GB) | `http://127.0.0.1:8080/v1` | 131,072 | local |
| Student, hosted, development | Together | `meta-models/Muse-Glimmer-30B` | `https://api.together.ai/v1` | 131,072 | $0.35 / $0.04 / $1.50 |
| Student, hosted, development | OpenRouter | `meta/muse-glimmer-30b` | `https://openrouter.ai/api/v1` | 131,072 | $0.30 / $0.04 / $1.20 via DeepInfra, $0.35 / $0.04 / $1.50 via Together |
| Student, hosted, development | DeepInfra | `meta-models/Muse-Glimmer-30B` | `https://api.deepinfra.com/v1/openai` | 131,072 | $0.30 / $0.04 / $1.20 |

Fireworks lists `accounts/fireworks/models/muse-glimmer-30b` but marks serverless "Not Supported", so it is not a development endpoint without a dedicated deployment (see Muse Glimmer, hosted).

Sources for the table:

- Meta rows: https://dev.meta.ai/docs/pricing-rate-limits, https://dev.meta.ai/docs/models, https://dev.meta.ai/docs/quickstart (the 131,072 output figure comes from its OpenCode config example).
- Baseten row: https://docs.baseten.co/inference/model-apis/reasoning (slug `meta-models/muse-spark-open`), https://www.baseten.co/pricing, https://www.baseten.co/library/muse-spark-open/. None of them contains `-1026`.
- Modal row: https://modal.com/library/meta/muse-spark-open, https://modal.com/docs/guide/endpoint-integrations, https://openrouter.ai/api/v1/models/meta/muse-spark-open/endpoints (Modal context 1,000,000).
- Ollama row: https://ollama.com/library/muse-glimmer, https://docs.ollama.com/context-length.
- GGUF row: https://huggingface.co/unsloth/Muse-Glimmer-30B-GGUF.
- Together row: https://docs.together.ai/docs/serverless-models, https://docs.together.ai/docs/openai-api-compatibility.
- OpenRouter row: https://openrouter.ai/api/v1/models/meta/muse-glimmer-30b/endpoints, https://openrouter.ai/docs/quickstart.
- DeepInfra row: https://deepinfra.com/meta-models/Muse-Glimmer-30B, https://docs.deepinfra.com/chat/overview.
- Fireworks: https://fireworks.ai/models/fireworks/muse-glimmer-30b.
- Other mentors and the GPU-sized build: the sections "Other mentors and connections" and "The GPU-sized build in Ollama" below.

## Meta Model API

### Access

- Base URL `https://api.meta.ai/v1`, Bearer auth (`Authorization: Bearer <key>`). Keys are created in the dashboard under API keys, start with `LLM_`, and belong to a team. Keys on one team share rate limits. Sources: https://dev.meta.ai/docs/quickstart, https://dev.meta.ai/docs/authentication
- The docs call the key `MODEL_API_KEY`. The OpenAI SDK, the Anthropic SDK and other compatible clients do not read it, so the adapter passes the key and base URL explicitly. Source: https://dev.meta.ai/docs/authentication
- Three protocols share the host: Chat Completions (`POST /v1/chat/completions`), Responses (`POST /v1/responses`) and an Anthropic-style Messages API (`POST /v1/messages`, `POST /v1/messages/count_tokens`). Sources: https://dev.meta.ai/docs/models, https://dev.meta.ai/docs/protocols/messages
- `GET /v1/models` lists only models Meta hosts. Glimmer and Spark Open are not in it. Owner-checked on 2026-10-27, it returned `muse-wonder-1.0`, `sam-3.1`, `muse-spark-1.3-contributor`, `muse-voice-transcribe-1.0`, `muse-spark-1.3`, `muse-image-1.0`, `muse-spark-1.2-contributor`, `muse-spark-1.2`, `muse-spark-1.1`. The documented list matches. Source: https://dev.meta.ai/docs/models
- Owner-checked request (recorded in `docs/PROGRESS.md`): `POST /v1/chat/completions` with `model: muse-spark-1.3`, one function tool, `reasoning_effort: "low"` and `max_completion_tokens: 400` returned a tool call (542 prompt tokens, 243 completion tokens, 173 of them reasoning). Usage carried `prompt_tokens`, `completion_tokens`, `completion_tokens_details.reasoning_tokens` and `prompt_tokens_details.cached_tokens`.

### Models

| Id | Context | Tier | Notes |
| --- | --- | --- | --- |
| `muse-spark-1.3` | 1,048,576 | Standard | Default in Meta's examples. Supports every reasoning level including `max`. |
| `muse-spark-1.3-contributor` | 1,048,576 | Contributor | Supports every reasoning level except `max`. |
| `muse-spark-1.2`, `muse-spark-1.2-contributor` | 1,048,576 | Standard, Contributor | Meta recommends 1.2 over 1.3 for audio input. |
| `muse-spark-1.1` | 1,048,576 | Standard only | Not available in Muse Code. |
| `muse-wonder-1.0` | 1,048,576 | Standard only | Preview. $4.00 / $0.20 / $20.00. Not used by Architect. |

Source for the table: https://dev.meta.ai/docs/models, https://dev.meta.ai/docs/reasoning

- Muse Spark accepts text, image, video, audio and PDF and returns text. On 1.3, audio support is partial and quality may be degraded; Meta recommends 1.2 for audio. Source: https://dev.meta.ai/docs/models
- Max output: the models page gives no limit. Meta's OpenCode example in the quickstart sets `"context": 1048576` and `"output": 131072` for `muse-spark-1.3`. OpenRouter lists 943,718 for the same model, which is 90% of the context and looks derived, not a Meta limit. Sources: https://dev.meta.ai/docs/quickstart, https://openrouter.ai/api/v1/models/meta/muse-spark-1.3/endpoints
- The default for `max_completion_tokens` depends on the model and is not stated. Source: https://dev.meta.ai/docs/protocols/chat-completions

### Pricing

| Model | Cached input | Input | Output |
| --- | --- | --- | --- |
| `muse-spark-1.3`, `muse-spark-1.2`, `muse-spark-1.1` | $0.15 | $1.25 | $4.25 |
| `muse-spark-1.3-contributor`, `muse-spark-1.2-contributor` | $0.002 | $0.10 | $0.20 |

Source: https://dev.meta.ai/docs/pricing-rate-limits (the real URL; `/docs/pricing` is a 404).

- Reasoning tokens bill at the output rate. Source: https://dev.meta.ai/docs/reasoning
- No long-context premium. Web search grounding is $2.50 per 1,000 queries on top of tokens. Source: https://dev.meta.ai/docs/pricing-rate-limits
- Cached tokens are a subset of the input count, reported in `usage.prompt_tokens_details.cached_tokens` (Chat Completions) or `usage.input_tokens_details.cached_tokens` (Responses). Source: https://dev.meta.ai/docs/prompt-caching

### Rate limits

Limits are per team and per model, not per key. There are no usage tiers on the page. Source: https://dev.meta.ai/docs/pricing-rate-limits

| Model | RPM | TPM |
| --- | --- | --- |
| `muse-spark-1.3`, `muse-spark-1.2`, `muse-spark-1.1`, `muse-wonder-1.0` | 3,000 | 4,000,000 |
| `muse-spark-1.3-contributor`, `muse-spark-1.2-contributor` | 150 | 3,000,000 |

- Background Responses submissions: 600 per minute per team.
- Successful token-based responses carry `x-ratelimit-limit-tokens`, `x-ratelimit-remaining-tokens`, `x-ratelimit-limit-requests` and `x-ratelimit-remaining-requests`.
- Over a limit the API returns 429. Retry with exponential backoff and jitter from about 500 ms, and wait at least `Retry-After` when it is present.
- How to request higher limits: the help page says the pricing page explains it, but the copy of the pricing page checked has no increase procedure (unverified). Source: https://dev.meta.ai/help/usage-and-limits/rate-limits

### Contributor tier terms

- Pay-as-you-go selects the tier by model id, `-contributor`. It exists for Muse Spark 1.3 and 1.2 only, not for Wonder, 1.1 or Voice Transcribe. Source: https://dev.meta.ai/docs/models
- The pricing page says the tier gives "discounted pricing or more usage in exchange for permission to use your content". Content means prompts, code, files, context you send, and the responses you receive. Source: https://dev.meta.ai/docs/pricing-rate-limits
- Terms of Service (last updated 2026-10-09), Section 6.1: Meta processes Contributor content as the Terms and Privacy Policy describe, and may use it to train, develop, evaluate and improve Meta models. Before training it takes steps designed to disassociate the content from your accounts, but it may use content for evaluation, safety and policy review without those steps (the data commitments page adds abuse and quality review). Sources: https://dev.meta.ai/legal/terms-of-service, https://dev.meta.ai/legal/commitments
- Section 6.2: "You must not submit sensitive, confidential, or personal information to the Contributor Services." There is no mechanism to exclude specific traffic from training. For traffic that must stay out, use Standard. Source: same.
- Section 5.1, Standard: Meta "will not use Content submitted in a request to the Standard Services to train Meta Models". Source: same.
- Section 10.3 lets Meta monitor use through automated or human review for compliance. Section 4.4 says Meta retains content and usage data "as needed". No retention period in days is stated for either tier in the Terms or on the data commitments page. Sources: same, https://dev.meta.ai/legal/commitments
- Zero Data Retention exists for qualified accounts through Meta sales. Contributor variants are not available to ZDR teams. Under ZDR, content flagged for an acceptable-use violation may be kept for up to 2 years. Sources: https://dev.meta.ai/help/policies-and-privacy/zero-data-retention, https://dev.meta.ai/help/policies-and-privacy/contributor-tier
- The help article calls the same tier "Discounted Services"; the Terms call it "Contributor Services". Users and their end users must be 18 or older.
- Responses `store` defaults to true, and no page states how long stored responses are kept. Source: https://dev.meta.ai/docs/protocols/responses

### Feature support by protocol

| Feature | Chat Completions | Responses | Messages |
| --- | --- | --- | --- |
| Function tools | Yes, nested under `function` | Yes, fields at top level | Yes, `custom` tools with `input_schema` |
| `custom` and built-in tools (`web_search`, `tool_search`) | `custom` returns 400; built-in tools are documented for Responses | Yes | `web_search` (only `user_location`), `tool_search` |
| `tool_choice` | Only `"auto"` | Only `"auto"` | `auto`, `any`, `none`; a named tool returns 400 |
| `parallel_tool_calls` | Default true | Default true | `disable_parallel_tool_use` |
| Structured output | `response_format` with `json_schema` | `text.format` | `output_config.format` with `json_schema` |
| Reasoning control | `reasoning_effort` | `reasoning.effort` | `output_config.effort`: low, medium, high, xhigh |
| Reasoning visible | No. `reasoning_content` is redacted to empty for external keys | Summary via `reasoning.summary` (`auto`, `concise`, `detailed`) | `thinking` blocks (summarized) |
| Reasoning carried across turns | No | Yes, with `previous_response_id` or `include: ["reasoning.encrypted_content"]` | `redacted_thinking` replay |
| Server-side state | None | `store` default true, `previous_response_id`, `background` | None (always stateless) |
| Token cap parameter | `max_completion_tokens` | `max_output_tokens` (minimum 16) | `max_tokens` (required) |

Sources: https://dev.meta.ai/docs/protocols/chat-completions, https://dev.meta.ai/docs/protocols/responses, https://dev.meta.ai/docs/protocols/messages, https://dev.meta.ai/docs/tool-calling, https://dev.meta.ai/docs/structured-output, https://dev.meta.ai/docs/reasoning

### `reasoning_effort`

- Schema enum: `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`, or null. Source: https://dev.meta.ai/docs/api-reference/chat-completions/schemas
- `none` returns 400 on Muse Spark and Muse Wonder because they always reason. Source: https://dev.meta.ai/docs/reasoning
- `max` works on `muse-spark-1.3` and `muse-wonder-1.0`, not on `muse-spark-1.3-contributor`. Source: same.
- Omitted: the model picks a level. There is no documented default. Source: same.
- The Chat Completions guide lists values only up to `xhigh`, while the schema and the reasoning page include `max`. `max` has not been tried against the live API (unverified). Sources: https://dev.meta.ai/docs/protocols/chat-completions, https://dev.meta.ai/docs/reasoning
- `max_completion_tokens` and `max_output_tokens` cover reasoning plus visible output. If the model spends the budget thinking, the visible answer is cut short. Sources: https://dev.meta.ai/docs/api-reference/chat-completions/schemas, https://dev.meta.ai/docs/reasoning

### Chat Completions request rules

- Roles: `developer`, `system`, `user`, `assistant`, `tool`. `developer` outranks `user`; `system` merges at the `developer` level, so prefer `developer`.
- `temperature` 0 to 2, default 1.0, and Meta says Muse Spark is tuned for the default. `top_p` must be above 0 (`top_p: 0` returns 400). Use one of the two, not both.
- Returns 400: `stop`, `logit_bias`, `prediction`, `verbosity`, `modalities`, `audio`, `web_search_options`, `n` above 1, `logprobs: true`, `reasoning_effort: "none"`, `max_output_tokens`, `text.format`. Leave `frequency_penalty` and `presence_penalty` unset.
- `seed` is deprecated and gives best-effort determinism only.
- Tool replay is strict. An assistant message with `tool_calls` must be followed by matching `tool` messages before the next assistant turn, or the call returns 400.
- Tool names match `^[a-zA-Z0-9_.-]+$` with at most one dot.
- Reasoning does not carry across Chat Completions turns. For multi-step agent work, Meta points to Responses.

Sources: https://dev.meta.ai/docs/protocols/chat-completions, https://dev.meta.ai/docs/tool-calling

### Structured output

- Chat Completions: `response_format: {"type": "json_schema", "json_schema": {"name": ..., "schema": {...}}}`. Decoding is constrained, so output conforms to the schema. `strict` defaults to false and only controls whether the server validates the schema against a strict subset.
- Strict subset: plain object root, `additionalProperties: false` on every object, every key in `required`, no `allOf` or `oneOf`, `anyOf` only below the root.
- Limits (400 if exceeded): nesting depth 10, 5,000 properties, 120,000 characters of names and enum values, 1,000 enum values, 200,000 nodes after `$ref` inlining. Recursive `$ref` schemas are rejected.
- Combines with tool calling. The page does not discuss reasoning or streaming with structured output.
- `response_format` types in the schema: `text`, `json_schema`, `json_object`.

Sources: https://dev.meta.ai/docs/structured-output, https://dev.meta.ai/docs/api-reference/chat-completions/schemas

### Tool calling

- `tool_choice` accepts only `"auto"`. `"none"`, `"required"` and a named function return 400 (schema enum is `auto` alone). The app must handle both a tool call and plain text.
- `parallel_tool_calls` defaults to true and applies to function tools. `max_tool_calls` counts only built-in tools.
- `strict: true` on a tool only validates the schema. Validate arguments in code regardless.
- On Responses, `call_id` needs 1 to 64 characters on both `function_call` and `function_call_output`, and results must keep the order of the calls when `previous_response_id` is not used.
- Streaming: Chat Completions delivers `tool_calls` deltas, accumulated by `index`. Responses sends `response.function_call_arguments.delta` and `.done`.

Sources: https://dev.meta.ai/docs/tool-calling, https://dev.meta.ai/docs/api-reference/chat-completions/schemas

### Streaming

- Chat Completions: `stream: true` returns server-sent events. Text is at `choices[0].delta.content` (can be null), and the last chunk carries `finish_reason`. Usage appears only with `stream_options: {"include_usage": true}`, on the final chunk. Source: https://dev.meta.ai/docs/cookbook/streaming-responses
- Responses: usage is always included in streamed responses; `stream_options.include_usage` has no effect. A failed stream ends with `response.failed` or an `error` event. Source: https://dev.meta.ai/docs/protocols/responses
- Reasoning deltas are not streamed on either endpoint. Responses streams reasoning summaries (`response.reasoning_summary_text.delta`) when requested.
- Non-streaming requests that run too long return 504. Streaming requests are exempt. Source: https://dev.meta.ai/docs/protocols/chat-completions

### Errors and retries

Error body: `{"error": {"message", "type", "param", "code"}}`. Rely on `type` and `message`; `code` is often null. Source: https://dev.meta.ai/docs/error-handling

| Status | Type and code | Retry |
| --- | --- | --- |
| 400 | `invalid_request_error`; code usually null; `content_policy_violation` for policy-violating media | No |
| 401 | `authentication_error`, `invalid_api_key` | No |
| 402 | `billing_error`, `billing_not_configured` | No |
| 403 | key lacks permission for the model or feature | No |
| 404 | `invalid_request_error`, `model_not_found` or `file_not_found`; unknown paths return an empty body | No |
| 413 | `payload_too_large` | No, not unchanged |
| 429 | `rate_limit_error`, `rate_limit_exceeded` | Yes |
| 500 | server error, including malformed model output | Yes |
| 503 | `server_error`: `server_shutting_down`, `service_overloaded`, `backend_unavailable` | Yes, honor `Retry-After` (60 s for overloaded and unavailable) |
| 504 | `gateway_timeout` | Not by repeating the same request. Stream, use `background: true` on Responses, or shrink input, output cap or effort. |

- Backoff for 429 and 500: start at 0.5 to 1 s, double each try, add 0 to 1 s of jitter, 3 to 5 attempts.
- Meta's retry recipe uses a 0.5 s base, `0.5 * 2**attempt` plus `uniform(0, 0.5)`, and 5 attempts. Source: https://dev.meta.ai/docs/cookbook/error-handling-retry

### Prompt caching

- Automatic. No flag or breakpoints. Minimum prefix length is not stated. Put the system prompt, tool definitions and examples first and the changing user turn last.
- `prompt_cache_key` (both endpoints) raises hit rates at volume; do not use per-user values. `prompt_cache_retention: "24h"` is a hint, documented as Responses only on the caching page although the Chat Completions page also lists it.
- Caching is independent of `store`.

Sources: https://dev.meta.ai/docs/prompt-caching, https://dev.meta.ai/docs/protocols/chat-completions

## Muse Spark Open

### Model facts

- Open-weight sibling of Muse Spark for agentic and coding work. 816B parameters, mixture of experts, 42B active per token. 62 layers, 256 experts with 8 active. Source: https://dev.meta.ai/docs/muse-spark-open, https://huggingface.co/meta-models/Muse-Spark-Open-816B-A42B
- Context 1,048,576. Input text, image, audio, video; output text. Only 16 of the 62 layers keep a full-length cache; the other 46 use a 2,048-token window. Sources: https://dev.meta.ai/docs/muse-spark-open, https://dev.meta.ai/docs/muse-spark-open/settings
- Weights: BF16 about 1.65 TB, NVFP4 about 537 GB. Hugging Face repos `meta-models/Muse-Spark-Open-816B-A42B` and `meta-models/Muse-Spark-Open-816B-A42B-NVFP4`. Meta's docs serve NVFP4 on a single four-GPU Blackwell node (B300 in its recipes); the model card says NVFP4 needs at least 700 GB of VRAM and BF16 about 2 TB. Sources: https://dev.meta.ai/docs/muse-spark-open/get-the-model, https://dev.meta.ai/docs/muse-spark-open/settings, https://huggingface.co/meta-models/Muse-Spark-Open-816B-A42B
- License: Muse Model License dated 2026-10-15, plus an Acceptable Use Policy. This is not Apache 2.0. The model card summary says commercial use is allowed, products must "prominently display" Built with Muse Spark Open, and a licensee offering the model as a third-party API above $20 million gross revenue in 12 months must sign a separate agreement. The full text is behind a login, so these terms are unverified until `LICENSE.md` is read. Source: https://huggingface.co/meta-models/Muse-Spark-Open-816B-A42B
- Recommended sampling: temperature 1.0, top_p 1.0, top_k disabled. Source: https://dev.meta.ai/docs/muse-spark-open/settings
- It always reasons. `reasoning_effort` takes `low` (strength 8), `medium` (32), `high` (256), `xhigh` (512, the default). Self-hosted servers reject `none` and `max`. Meta recommends setting the level explicitly and streaming. Source: https://dev.meta.ai/docs/muse-spark-open/prompting
- Tool calls use the ATEM format (`<atem:function_calls>`, `<atem:invoke name="...">`, `<atem:parameter name="...">`); hosted servers parse it into standard `tool_calls`. Source: same.

### Baseten

Two ways to run it. Use Model APIs.

#### Model APIs

- Base URL `https://inference.baseten.co/v1`. Endpoints: `/chat/completions`, `/responses`, and `/messages` (beta, Anthropic-style; set the SDK base URL to `https://inference.baseten.co` and override its default `x-api-key` header so `Authorization` is sent). Source: https://docs.baseten.co/inference/model-apis/overview
- Auth: `Authorization: Bearer $BASETEN_API_KEY`. The legacy `Authorization: Api-Key <key>` scheme is also accepted. Sources: same, https://docs.baseten.co/inference/calling-your-model
- Baseten has no separate Model APIs quickstart page; the overview's "Run inference" section is the closest. Source: https://docs.baseten.co/inference/model-apis/overview
- Every public page that names the model uses `meta-models/muse-spark-open`. Sources: https://docs.baseten.co/inference/model-apis/reasoning, https://docs.baseten.co/inference/model-apis/audio, https://www.baseten.co/library/muse-spark-open/, https://www.baseten.co/resources/changelog/muse-spark-open-and-nemotron-35-super-vl-available-on-baseten/ (announced 2026-10-15)
- Baseten's partner notes for Meta's developer program say to use `meta-models/muse-spark-open-1026` instead of the documented id. No public Baseten or Meta page contains it (searched docs, library page, pricing page, changelog, web search). Baseten does date-suffix some slugs (`deepseek-ai/DeepSeek-V4.1-Flash-1017`, `deepseek-ai/DeepSeek-V4-Flash-0731`), which fits a snapshot name, but that is not confirmation. Verify with `GET https://inference.baseten.co/v1/models` or `baseten model-api list` using the key. Sources: https://docs.baseten.co/inference/function-calling, https://docs.baseten.co/inference/model-apis/reasoning
- Price: $1.25 / $0.15 / $4.25. Source: https://www.baseten.co/pricing
- Context: Baseten's pages do not state it. OpenRouter lists 1,048,576 context and 943,718 max completion for its BaseTen endpoint (third party). Source: https://openrouter.ai/api/v1/models/meta/muse-spark-open/endpoints
- Rate limits are account-tier defaults, not per model. A model or organization setting can differ. The effective limits for a model come from `GET /v1/model_apis/{model_api_name}`. Source: https://docs.baseten.co/inference/model-apis/pricing-and-limits

| Account tier | RPM | TPM |
| --- | --- | --- |
| Basic, unverified | 15 | 100,000 |
| Basic, verified | 120 | 500,000 |
| Pro | 120 | 1,000,000 |
| Enterprise | custom | custom |

- Structured outputs and JSON mode are not supported for Muse Spark Open on Model APIs. Baseten's overview says "All except Muse Spark Open support structured outputs and JSON mode", and OpenRouter's parameter list for its Baseten endpoint has no `response_format` either. Sources: https://docs.baseten.co/inference/model-apis/overview, https://openrouter.ai/api/v1/models/meta/muse-spark-open/endpoints
- Tool calling is supported (all Model APIs). Baseten's tool page lists `tool_choice` as `auto`, `none`, `required` or a named function in general, but does not cover Muse Spark Open specifically, so its behavior here is unverified. Source: https://docs.baseten.co/inference/function-calling
- Reasoning: always on. `reasoning_effort` is `low`, `medium`, `high` or `xhigh` (default `xhigh`). `none` and `minimal` run at `low` instead of returning an error. The text comes back as `reasoning_content` on the assistant message in non-streaming responses. The streaming delta field is not documented (unverified). Reasoning tokens count in `completion_tokens` and `completion_tokens_details.reasoning_tokens`. Sources: https://docs.baseten.co/inference/model-apis/reasoning, https://docs.baseten.co/reference/inference-api/chat-completions
- Request fields from Baseten's generic Chat Completions reference: `max_tokens` (default 4096, maximum 262,144; truncated if input plus `max_tokens` exceeds context), `top_k` (default 50, `-1` disables), `stream_options` with `include_usage` and `continuous_usage_stats`. The schema has no `max_completion_tokens` (unverified whether it is accepted). Meta recommends top_k disabled for Spark Open; whether Baseten applies its default of 50 to this model is unverified. Source: https://docs.baseten.co/reference/inference-api/chat-completions
- Muse Spark Open specifics: `n` above 1 returns 400; `logprobs` and `top_logprobs` are accepted but return nothing; neither `seed` nor `temperature: 0` guarantees reproducible output. Source: https://docs.baseten.co/inference/model-apis/overview
- Media: `image_url` (up to 8 images, 10 MB each by URL), `video_url` (up to 2 videos, 200 MB, 300 seconds, at most 96 sampled frames, audio track ignored), `audio_url` (up to 4 files, 25 MB and 5 minutes each). PDFs are not accepted. All media combined must fit 200 MB. Baseten's vision page does not document the `video_url` part name; Meta's deploy page lists `image_url`, `video_url` and `audio_url`. Sources: https://docs.baseten.co/inference/model-apis/vision, https://docs.baseten.co/inference/model-apis/audio, https://dev.meta.ai/docs/muse-spark-open/deploy
- Errors Baseten lists: 400, 401, 402, 404, 429, 500, 529. Source: https://docs.baseten.co/inference/model-apis/overview

Example request, assembled from the documented fields (Baseten's reasoning page has no Muse-specific example); not run:

```
POST https://inference.baseten.co/v1/chat/completions
Authorization: Bearer <BASETEN_API_KEY>
Content-Type: application/json

{
  "model": "meta-models/muse-spark-open-1026",
  "messages": [{"role": "user", "content": "..."}],
  "reasoning_effort": "low",
  "max_tokens": 2048,
  "stream": true
}
```

#### Dedicated deployment

- The library page lists a dedicated deployment at https://app.baseten.co/deploy/baseten/muse-spark-open-816b-a42b with weights from `meta-models/Muse-Spark-Open-816B-A42B-NVFP4`. It does not state GPU requirements or instance type. Source: https://www.baseten.co/library/muse-spark-open/
- Calling a dedicated deployment: `https://model-{model_id}.api.baseten.co/environments/production/sync/v1`, same Bearer key, and `model` set to the deployment's `--served-model-name`. These come from Baseten's general guide, not from a Muse Spark Open page. Source: https://docs.baseten.co/inference/calling-your-model
- NVFP4 weights are about 537 GB and Meta's recipes use four Blackwell GPUs, so a dedicated deployment means paying for a multi-GPU node by the hour. Baseten's dedicated pricing was not checked. Source: https://dev.meta.ai/docs/muse-spark-open/settings

### Modal Endpoints

- Modal's model page says the Shared Endpoint "is OpenAI-compatible and already live", billed per token, and gives the create command `modal endpoint create --shared --model meta-models/Muse-Spark-Open-816B-A42B`. Source: https://modal.com/library/meta/muse-spark-open
- Base URL: Modal's guide writes `<your-endpoint-url>` and says to copy it from the dashboard. Its integrations page connects through `https://inference.us-west.modal.direct` and shows a `/v1` suffix for an OpenAI-style client (the Codex config uses `https://inference.us-west.modal.direct/v1` with the Responses wire format). Sources: https://modal.com/docs/guide/endpoints, https://modal.com/docs/guide/endpoint-integrations
- `model` value: the guide says use the value in the dashboard's request example, or read it from `GET <endpoint-url>/v1/models`. The integrations page says to set `model` to the endpoint's hostname, for example `my-endpoint.us-west.modal.direct`. Which one applies to a given endpoint is unverified until `/v1/models` is read.
- Auth: Shared Endpoints always need a Proxy Token. Create it with `modal workspace proxy-tokens create`, join token id and secret with a period, and send `Authorization: Bearer wk-<id>.ws-<secret>`. The same combined string works as the `api_key` of an OpenAI client. Sources: both Modal pages above.
- APIs: OpenAI Chat Completions and Responses, and the Anthropic-style Messages API. Source: https://modal.com/docs/guide/endpoints
- Price: $1.25 / $0.15 / $4.25 per million tokens. Input modalities listed by Modal: text, image, audio. Context 1M. Sources: https://modal.com/docs/guide/supported-models, https://modal.com/library/meta/muse-spark-open
- Rate limits, max output tokens and the reasoning field name: not stated by Modal. OpenRouter lists the Modal endpoint at 1,000,000 context and 262,144 max completion tokens, with `tools`, `tool_choice`, `reasoning`, `reasoning_effort` and `response_format` among its parameters (third party). Source: https://openrouter.ai/api/v1/models/meta/muse-spark-open/endpoints
- Optional header `Modal-Routing-Affinity-Key` keeps one conversation on one container; use one key per conversation. Source: https://modal.com/docs/guide/endpoints

### Other hosts Meta lists

| Host | Model id | Base URL | Notes |
| --- | --- | --- | --- |
| Together | `meta-models/Muse-Spark-Open-816B-A42B` in Together's own docs; `meta-models/muse-spark-open` on Meta's deploy page | `https://api.together.ai/v1` (Together docs), `https://api.together.xyz/v1` (Meta page) | NVFP4, 1,048,576 context, $1.25 / $0.15 / $4.25. The two ids disagree. |
| Fireworks | `accounts/fireworks/models/muse-spark-open` | `https://api.fireworks.ai/inference/v1` | `reasoning_effort` low to xhigh, default xhigh, `none` rejected. |
| Groq | `meta-models/muse-spark-open` | `https://api.groq.com/openai/v1` | Needs organization approval. 131,072 context. |
| Nebius Token Factory | `meta-models/muse-spark-open` (case-sensitive) | `https://api.tokenfactory.us-north1.nebius.com/v1/` | Check with `GET /v1/models`. |
| OpenRouter | `meta/muse-spark-open` | `https://openrouter.ai/api/v1` | Providers: Makora, Modal, Together, Nebius, Fireworks, BaseTen. $1.25 / $0.15 / $4.25 on all. |

Sources: https://dev.meta.ai/docs/muse-spark-open/deploy, https://docs.together.ai/docs/serverless-models, https://openrouter.ai/api/v1/models/meta/muse-spark-open/endpoints

### Self-hosting reference

- SGLang: `--reasoning-parser muse --tool-call-parser muse`. vLLM: the same two flags plus `--enable-auto-tool-choice`. TensorRT-LLM: `--custom_tokenizer musespark_open --tool_parser musespark --reasoning_parser musespark`. llama.cpp: `--chat-template-kwargs '{"reasoning_effort":"low"}'`. Source: https://dev.meta.ai/docs/muse-spark-open/deploy
- `eos_token_id` is `[200001, 200008]`. Never stop on `<|eom|>` (200007); it ends a message but not the turn, so stopping there cuts off tool calls and answers. Source: https://dev.meta.ai/docs/muse-spark-open/settings
- Pass the date with `chat_template_kwargs: {"current_date": "YYYY-MM-DD"}`. Source: https://dev.meta.ai/docs/muse-spark-open/prompting

## Muse Glimmer

### Model facts

- Dense decoder-only multimodal model distilled from Muse Spark, about 29.6B parameters including a roughly 1.8B vision encoder. 52 layers, hidden size 6656, 32 query heads and 2 KV heads (head dimension 128), a sliding window of 2048 on three of every four layers, vocabulary 202,048. Apache 2.0. Released August 2026, knowledge cutoff 2026-01-04. Source: https://huggingface.co/meta-models/Muse-Glimmer-30B
- Context: 131,072 and longer. Input text and image (no audio; video only as frames). Output text. Sources: same, https://dev.meta.ai/docs/muse-glimmer
- bf16 weights are about 60 GB and need about 72 GB of VRAM to serve. Source: https://dev.meta.ai/docs/muse-glimmer/deploy
- Meta's paper reports average accuracy of 75.7% for BF16 and 74.8% for Q4_K_M across its benchmark set. Source: https://arxiv.org/html/2610.24628v2 (Table 3)

### Sampling

- Meta: temperature 1.0, top_p 0.95, top_k 64. Ollama's `params` blob for the model is exactly `{ "temperature": 1, "top_k": 64, "top_p": 0.95 }`. `min_p` is not specified. Sources: https://huggingface.co/meta-models/Muse-Glimmer-30B, https://ollama.com/library/muse-glimmer:30b
- Do not use greedy decoding (`temperature: 0`); Meta's vLLM page says it gives flat, repetitive output. If sampling is set per request, set all three values. Source: https://dev.meta.ai/docs/muse-glimmer/deploy
- Meta's llama.cpp page uses `temperature: 0` in its own examples, so the guidance is not applied consistently. Source: https://github.com/meta-models/meta-oss-cookbook/blob/main/muse-glimmer/inference-server/llama-cpp.md

### Reasoning control

- The model always reasons. The chat template writes `Reasoning strength: <value>.` into the system block. The template variable is `reasoning_strength`, with `low`, `medium`, `high` (default) and `xhigh`. The template renders any truthy string and has no off value. Sources: https://huggingface.co/meta-models/Muse-Glimmer-30B/raw/main/chat_template.jinja, https://dev.meta.ai/docs/muse-glimmer/prompting
- Meta's llama.cpp notes say reasoning "cannot be turned off here" because the template opens the thinking channel unconditionally. `--reasoning off` and `reasoning_effort: "none"` leave output unchanged. Sources: https://huggingface.co/meta-models/Muse-Glimmer-30B-GGUF, https://github.com/meta-models/meta-oss-cookbook/blob/main/muse-glimmer/inference-server/llama-cpp.md
- Measured by Meta on one agentic decision at temperature 0: 1,811 completion tokens at the default `high`, 752 at `medium`, 256 at `low`. `xhigh` not measured. Reasoning counts against the token cap, and a request that hits the cap mid-thought returns empty content with `finish_reason: "length"`. Source: same cookbook page.

| Runtime | How to set strength | Where reasoning appears |
| --- | --- | --- |
| Ollama native `/api/chat` | `think`: `false`, `"low"`, `"medium"`, `"high"`, `"max"` (default `"high"`), from Ollama's source | `message.thinking` |
| Ollama `/v1` | `reasoning_effort` or `reasoning.effort`; `none` maps to `think: false`, `minimal` to `low`, `xhigh` and `ultra` to `max` | `message.reasoning` |
| llama.cpp | `--chat-template-kwargs '{"reasoning_strength":"low"}'` or `chat_template_kwargs` per request; `reasoning_effort` is not implemented | `reasoning_content` |
| SGLang | `--reasoning-parser muse` | `message.reasoning_content` |
| vLLM | `--reasoning-parser muse_glimmer`; no strength parameter documented | `message.reasoning`, `delta.reasoning` |

Sources: https://github.com/ollama/ollama/blob/main/model/renderers/glimmer.go, https://github.com/ollama/ollama/blob/main/openai/openai.go, https://docs.ollama.com/capabilities/thinking, https://dev.meta.ai/docs/muse-glimmer/deploy, https://github.com/meta-models/meta-oss-cookbook/blob/main/muse-glimmer/inference-server/vllm.md

### Chat template and tool-call format

- Turns open with `<|start|>role` followed by `<|message|>`. `<|eot|>` ends a turn and `<|end_of_text|>` ends the text; both are stop tokens (`eos_token_id` `[200001, 200008]`). `<|eom|>` (200007) ends a message while the turn continues and is not a stop token. Source: https://dev.meta.ai/docs/muse-glimmer/prompting, https://dev.meta.ai/docs/muse-glimmer/deploy
- Assistant spans are addressed: `to=self` is reasoning, `to=<tool>` is a tool call, `to=user` is the answer. Source: https://github.com/meta-models/meta-oss-cookbook/blob/main/muse-glimmer/agentic-fundamentals/README.md
- Tools go in the system block as JSON schemas under `// Function schemas`, with an example of the call format. A call is `<|start|>assistant to=<name><|message|>` then `<atem:function_calls><atem:invoke name="..."><atem:parameter name="...">...</atem:parameter></atem:invoke></atem:function_calls>`. Scalars are written as-is, lists and objects as JSON, and the output is parsed with regular expressions, not an XML parser. Source: https://huggingface.co/meta-models/Muse-Glimmer-30B/raw/main/chat_template.jinja
- Results come back as a `tool` message: `<|start|>tool <name><|message|><tool_output name="...">...</tool_output><|eot|>`. The tool name comes from the message `name` or from matching `tool_call_id`. When rendering with the template directly, `arguments` must be a mapping, not a JSON string. Source: same.
- Parallel calls: Meta's prompting page says only one tool call per turn is supported. The cookbook and the template show several calls in one turn as consecutive assistant messages separated by `<|eom|>`. Ollama's parser accepts several calls across messages, not several `<atem:invoke>` elements inside one block. Treat parallel calls as unreliable. Sources: https://dev.meta.ai/docs/muse-glimmer/prompting, https://github.com/meta-models/meta-oss-cookbook/blob/main/muse-glimmer/inference-server/vllm.md, https://github.com/ollama/ollama/blob/main/model/parsers/glimmer.go

### Ollama

- Requires Ollama 0.32.7 or later. Source: https://dev.meta.ai/docs/muse-glimmer/deploy
- Tags (all 128K context, text and image input): `muse-glimmer:latest`, `muse-glimmer:30b` and `muse-glimmer:30b-q4_K_M` share one digest and are 18 GB; `30b-q8_0` 31 GB; `30b-bf16` 57 GB; `30b-mlx` 19 GB, `30b-nvfp4` 17 GB, `30b-mxfp8` 33 GB and `30b-mlx-bf16` 60 GB for Apple silicon; plus `-dflash` variants. No tag is under 17 GB, so none fits a 12 GB GPU. Source: https://ollama.com/library/muse-glimmer/tags
- Native API `POST http://localhost:11434/api/chat`, no key. OpenAI-compatible `http://localhost:11434/v1` with a placeholder Bearer key (`ollama`). Source: https://dev.meta.ai/docs/muse-glimmer/deploy
- Default context is 4k on GPUs under 24 GiB VRAM (32k for 24 to 48 GiB, 256k at 48 GiB or more). Change it with `OLLAMA_CONTEXT_LENGTH` or, on the native API, `options.num_ctx`. The OpenAI endpoint cannot set it per request; it needs the environment variable or a Modelfile with `PARAMETER num_ctx`. `ollama ps` shows the loaded context and the CPU/GPU split. Sources: https://docs.ollama.com/context-length, https://docs.ollama.com/api/openai-compatibility, https://docs.ollama.com/api/chat
- Native request fields: `think` (boolean or a string that must match the model's values from `POST /api/show`), `format` (`"json"` or a JSON schema), `options` (`num_ctx`, `num_predict`, `temperature`, `top_p`, `top_k`, `min_p`, `seed`, `stop`), `keep_alive`. Response: `message.content`, `message.thinking`, `message.tool_calls` (arguments are an object), `done_reason`, `prompt_eval_count`, `eval_count`, `prompt_eval_cached_count`. Sources: https://docs.ollama.com/api/chat, https://docs.ollama.com/capabilities/thinking, https://docs.ollama.com/capabilities/tool-calling
- Tool results go back as `role: "tool"` with `tool_name` set to the function name. Source: https://docs.ollama.com/capabilities/tool-calling

Example request, assembled from the documented fields; not run:

```
POST http://127.0.0.1:11434/api/chat

{
  "model": "muse-glimmer:30b",
  "messages": [{"role": "user", "content": "..."}],
  "think": "low",
  "stream": false,
  "options": {"num_ctx": 16384, "num_predict": 2048, "temperature": 1.0, "top_p": 0.95, "top_k": 64}
}
```

- `/v1/chat/completions` supports `tools`, `stream`, `stream_options.include_usage`, `response_format`, `reasoning_effort`, `reasoning.effort`, `max_tokens`, `seed`, `temperature`, `top_p`. It does not support `tool_choice`, `logit_bias`, `user`, `n`, logprobs, or image URLs (base64 images only). In Ollama's source, `json_object` maps to JSON mode and `json_schema` passes its schema through. Sources: https://docs.ollama.com/api/openai-compatibility, https://github.com/ollama/ollama/blob/main/openai/openai.go
- Thinking, from Ollama's `main` source on 2026-10-27 (the installed release may differ): the Glimmer renderer reports `think` values `false, "low", "medium", "high", "max"` with default `"high"`. `think: false` writes `Reasoning strength: none.` into the system block, which is not a level Meta documents, and the parser then discards the thinking text. So `false` hides reasoning; it does not clearly stop it (unverified). `"max"` is passed through as `Reasoning strength: max.`, while Meta's levels end at `xhigh`; `"xhigh"` is not in Ollama's list. Sources: https://github.com/ollama/ollama/blob/main/model/renderers/glimmer.go, https://github.com/ollama/ollama/blob/main/model/parsers/glimmer.go
- Open bug: with thinking off and a JSON schema `format`, `muse-glimmer:30b` (v0.34.4) sometimes dropped the first field of the reply (3 of 10 calls in the reporter's workload). The proposed fix is pull request 18687, still open on the check date. Source: https://github.com/ollama/ollama/pull/18687
- Template merged upstream on 2026-08-13: a system prompt that says "reasoning effort" is rewritten to "reasoning strength", and the renderer skips its own line when the prompt already has one. Source: https://github.com/ollama/ollama/pull/17732
- Third-party GGUF pulls (`ollama run hf.co/{user}/{repo}:{quant}`) use the template stored in the GGUF. A fork's notes say the official `muse-glimmer` manifest names renderer and parser `glimmer`. Whether a plain Hugging Face pull gets that parser (and so reliable tool calls and thinking separation) is unverified. Sources: https://huggingface.co/docs/hub/ollama, https://github.com/dogkeeper886/ollama37/pull/553

### llama.cpp

- Needs a build with the `muse-glimmer` architecture: Meta says b10353 or newer; the merge pull request's downstream note says b10358 was the first release with it. Merged 2026-08-10. Sources: https://dev.meta.ai/docs/muse-glimmer/deploy, https://github.com/ggml-org/llama.cpp/pull/26841
- Meta's server command: `llama serve -hf meta-models/Muse-Glimmer-30B-GGUF --hf-file Muse-Glimmer-30B-KQuant-17GB-Q4_K_M.gguf -a muse-glimmer -ngl 99 -c 131072 -np 1 --host 127.0.0.1 --port 8080 --api-key <your-key> --chat-template-kwargs '{"reasoning_strength":"low"}'`. Base URL `http://127.0.0.1:8080/v1`, model id from `-a`. Source: https://dev.meta.ai/docs/muse-glimmer/deploy
- Meta's GGUF card says `--jinja` is required for `llama-server` and `llama-mtmd-cli`, while the deploy page says no parser flag or `--chat-template-file` is needed. The template is embedded and the tool parser is selected automatically. Sources: https://huggingface.co/meta-models/Muse-Glimmer-30B-GGUF, https://dev.meta.ai/docs/muse-glimmer/deploy
- `-c` is divided by `-np`. A generation that runs out of room "produces no answer and no error", so check `n_ctx_slot` in the startup log. Source: https://github.com/meta-models/meta-oss-cookbook/blob/main/muse-glimmer/inference-server/llama-cpp.md
- Reasoning goes to `reasoning_content`; `--reasoning-format none` keeps it inline; `--reasoning-budget N` caps thinking tokens (named on the page, not demonstrated). Image input needs the `mmproj` file (downloaded automatically with `-hf`); `--no-mmproj` runs text only. Source: same.
- Memory in Meta's example: Q4_K_M 17GB with the vision projector at 131,072 context uses 19.0 GiB (text model 15.6, projector 1.3, KV cache and compute buffers 2.1). Source: https://dev.meta.ai/docs/muse-glimmer/quantization

### vLLM and SGLang

These need far more than 12 GB. They are for a rented GPU.

- vLLM: image `vllm/vllm-openai:muse-glimmer` (CUDA 13.0, no ROCm image), model `meta-models/Muse-Glimmer-30B`, flags `--served-model-name muse-glimmer --enable-auto-tool-choice --tool-call-parser muse_glimmer --reasoning-parser muse_glimmer --generation-config auto`. Parser names use underscores. Budget 72 GB of VRAM. Model support merged on 2026-08-14 (the cookbook page still calls it unmerged). Sources: https://dev.meta.ai/docs/muse-glimmer/deploy, https://github.com/vllm-project/vllm/pull/51655
- SGLang: `sglang serve --model-path meta-models/Muse-Glimmer-30B --served-model-name muse-glimmer --reasoning-parser muse --tool-call-parser muse`. Source: https://dev.meta.ai/docs/muse-glimmer/deploy

### Quantizations for a 12 GB GPU

Meta's own GGUFs start at 16.8 GB (`Muse-Glimmer-30B-KQuant-17GB-Q4_K_M.gguf` in `meta-models/Muse-Glimmer-30B-GGUF`; the Dynamic Q4_K_XL file is 19.7 GB). Meta does not address 12 GB. Smaller files come from other uploaders:

| Repo | File | Size |
| --- | --- | --- |
| `bartowski/Muse-Glimmer-30B-GGUF` | `Muse-Glimmer-30B-IQ2_XXS.gguf` | 8.92 GB |
| `bartowski/Muse-Glimmer-30B-GGUF` | `Muse-Glimmer-30B-IQ2_XS.gguf` | 9.58 GB |
| `bartowski/Muse-Glimmer-30B-GGUF` | `Muse-Glimmer-30B-IQ2_S.gguf` | 10.04 GB |
| `bartowski/Muse-Glimmer-30B-GGUF` | `Muse-Glimmer-30B-IQ2_M.gguf` | 10.66 GB |
| `unsloth/Muse-Glimmer-30B-GGUF` | `Muse-Glimmer-30B-UD-IQ2_XXS.gguf` | 10.7 GB |
| `bartowski/Muse-Glimmer-30B-GGUF` | `Muse-Glimmer-30B-Q2_K.gguf` | 11.04 GB |
| `unsloth/Muse-Glimmer-30B-GGUF` | `Muse-Glimmer-30B-UD-IQ2_XS.gguf` | 11.5 GB |
| `bartowski/Muse-Glimmer-30B-GGUF` | `Muse-Glimmer-30B-IQ3_XXS.gguf` | 11.55 GB |
| `unsloth/Muse-Glimmer-30B-GGUF` | `Muse-Glimmer-30B-UD-IQ2_M.gguf` | 12.3 GB |
| `bartowski/Muse-Glimmer-30B-GGUF` | `Muse-Glimmer-30B-IQ3_XS.gguf` | 12.32 GB |
| `bartowski/Muse-Glimmer-30B-GGUF` | `Muse-Glimmer-30B-Q2_K_L.gguf` | 12.35 GB |
| `unsloth/Muse-Glimmer-30B-GGUF` | `Muse-Glimmer-30B-UD-Q2_K_XL.gguf` | 12.4 GB |
| `bartowski/Muse-Glimmer-30B-GGUF` | `Muse-Glimmer-30B-Q3_K_S.gguf` | 12.79 GB |
| `unsloth/Muse-Glimmer-30B-GGUF` | `Muse-Glimmer-30B-UD-IQ3_XXS.gguf` | 13.1 GB |
| `bartowski/Muse-Glimmer-30B-GGUF` | `Muse-Glimmer-30B-IQ3_M.gguf` | 13.11 GB |
| `unsloth/Muse-Glimmer-30B-GGUF` | `Muse-Glimmer-30B-UD-Q3_K_XL.gguf` | 13.4 GB |
| `bartowski/Muse-Glimmer-30B-GGUF` | `Muse-Glimmer-30B-Q3_K_M.gguf` | 13.96 GB |
| `unsloth/Muse-Glimmer-30B-GGUF` | `Muse-Glimmer-30B-UD-IQ3_M.gguf` | 14.1 GB |
| `unsloth/Muse-Glimmer-30B-GGUF` | `Muse-Glimmer-30B-UD-Q4_K_XL.gguf` | 15.9 GB |

Vision needs a separate projector: `mmproj-kquant.gguf` 1.4 GB or `mmproj-Muse-Glimmer-30B-Q8_0.gguf` 2.05 GB in the Unsloth repo. With the projector loaded, 12 GB leaves room only for the smallest files; text-only use avoids it. Sizes are decimal GB (10.7 GB is about 9.97 GiB). Sources: https://huggingface.co/unsloth/Muse-Glimmer-30B-GGUF/tree/main, https://huggingface.co/bartowski/Muse-Glimmer-30B-GGUF, https://huggingface.co/meta-models/Muse-Glimmer-30B-GGUF

Fit on 12 GB:

- Meta reports 2.1 GiB for KV cache and compute buffers at a 131,072-token context. Only 13 of the 52 layers keep a full-length cache (the other 39 use a 2,048-token window). By arithmetic from the published config (2 KV heads, head dimension 128, 16-bit cache), the cache is about 0.3 GiB at 16K and 0.5 GiB at 32K, and the compute buffers are about 0.4 GiB (2.1 GiB minus the 1.7 GiB cache at 131,072). A file near 10 to 10.7 GB therefore has a chance of staying fully on a 12 GB card at a 16K to 32K context, and larger files do not. This is an estimate, not a measurement (unverified).
- bartowski advises picking a file 1 to 2 GB smaller than VRAM. Source: https://huggingface.co/bartowski/Muse-Glimmer-30B-GGUF
- Unsloth lists 2-bit `UD-Q2_K_XL` at "12-14+ GB" of memory, counted as RAM plus VRAM, and says llama.cpp can offload to RAM when memory is short, at lower speed. Source: https://unsloth.ai/docs/models/muse-glimmer
- AtomicChat's card marks only its 9.3 GB IQ2_XXS build for "12 GB + vision". Source: https://huggingface.co/AtomicChat/Muse-Glimmer-30B-GGUF
- By the same arithmetic, a 13.4 GB file spills roughly 2 GB from a 12 GB card, against about 7 GB for the 18 GB Ollama default (`docs/GOTCHAS.md`). Speed at either spill is unmeasured.

Quality, as stated by each source:

- Meta: about 4-bit builds lose 0.2% (Dynamic) and 1.0% (17GB) on average across 15 benchmarks, and "minimum to no degradation on agentic tasks". Nothing below 4-bit is published. Source: https://huggingface.co/meta-models/Muse-Glimmer-30B-GGUF
- bartowski's labels: Q4_K_M, Q4_K_S, IQ4_XS and larger K-quants "recommended"; Q3_K_L and Q3_K_XL "lower quality but usable"; IQ3_M "medium-low quality"; IQ3_XXS and IQ3_XS "lower quality"; Q3_K_M "low quality"; Q3_K_S "low quality, not recommended"; Q2_K and Q2_K_L "very low quality but surprisingly usable"; IQ2_M, IQ2_S and IQ2_XS "low quality" but usable; IQ2_XXS "very low quality" but usable. Below Q4 it suggests I-quants on Nvidia GPUs. Source: https://huggingface.co/bartowski/Muse-Glimmer-30B-GGUF
- Unsloth gives no 2-bit accuracy numbers and no warnings. It says a 2-bit build ran more than 100 tool calls in Unsloth Desktop, a vendor claim. Sources: https://huggingface.co/unsloth/Muse-Glimmer-30B-GGUF, https://unsloth.ai/docs/models/muse-glimmer
- AtomicChat (uploader-reported, measured against its own BF16 GGUF, not replicated; its files are sized differently from the others: 9.31, 11.16, 12.22, 14.92 and 19.06 GB). Mean KL divergence on agentic dialogue with tool calls, lower is better: Q4_K_M 0.065 (96.4% top-1 agreement), IQ3_M 0.121 (94.7%), IQ3_XXS 0.168 (92.9%), IQ2_M 0.236 (92.0%), IQ2_XXS 0.333 (87.9%). Source: https://huggingface.co/AtomicChat/Muse-Glimmer-30B-GGUF
- No source measures tool-calling pass rate at 2- or 3-bit. The sample job is the real test.

### The GPU-sized build in Ollama

Architect offers two builds of Glimmer and recommends the largest that runs entirely on the GPU it finds.

| Build | Ollama name | Comes from | Download | On disk | GPU memory at a 16K context |
| --- | --- | --- | --- | --- | --- |
| 4-bit (default) | `muse-glimmer:30b` | the Ollama library | 18,157,010,252 bytes | the same | about 19.5 GB (estimated from the file; 7 GB spill on a 12 GB card, `docs/GOTCHAS.md`) |
| 2-bit, for a 12 GB card | `muse-glimmer:30b-iq2` | `hf.co/unsloth/Muse-Glimmer-30B-GGUF:UD-IQ2_XXS` | 14,595,546,880 bytes | 10,746,373,364 bytes | 9,928,945,171 bytes, all of it on the GPU (`/api/ps`, measured on the 12 GB card) |

How Architect installs the 2-bit build, with Ollama 0.40.x:

1. `POST /api/pull` of `hf.co/unsloth/Muse-Glimmer-30B-GGUF:UD-IQ2_XXS`. A GGUF pulled this way runs on the chat template inside the file, not on the `glimmer` renderer and parser that split out tool calls and thinking for the library build (open question 5).
2. `POST /api/show` on the pulled model, and the weights' digest from the first `FROM` line of its Modelfile.
3. `POST /api/create` with `{"model": "muse-glimmer:30b-iq2", "files": {"model.gguf": "sha256:<digest>"}, "renderer": "glimmer", "parser": "glimmer", "parameters": {"temperature": 1, "top_k": 64, "top_p": 0.95}, "stream": false}`. This makes a text-only model from the weights alone, with the same renderer and parser as the library build and Meta's sampling.
4. `DELETE /api/delete` of the pulled model, which leaves the 10.7 GB of weights under the new name.

Checked live on 2026-10-28 with Ollama 0.40.9: `/api/create` with only `files`, `renderer` and `parser` returned success in 0.34 s, and `/api/show` on the result listed renderer and parser `glimmer`, capabilities `completion`, `tools` and `thinking` (no `vision`), and a Modelfile that starts from the weights only. That check made and deleted a temporary model; the install as a whole is covered by fakes, not run end to end, because GPU work was paused that day. `files` and `parameters` are documented at https://github.com/ollama/ollama/blob/main/docs/api.md#create-a-model; `renderer` and `parser` are confirmed only by that check.

How Architect decides what fits:

- The GPU comes from `nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits` (the card with the most memory), or on Apple silicon from 70 percent of the computer's memory, a little under the two thirds to three quarters macOS is said to let the GPU use (unverified). Nothing else is detected; without a reading Architect shows no fit and recommends the 4-bit build.
- 0.9 GB stays back for the driver and the display. A model fits when its GPU memory is at most the card's memory less that.
- A loaded model's fit comes from Ollama's own `size` and `size_vram` in `GET /api/ps`. A model that isn't loaded is estimated from its file size plus 0.7 GB for a 16K context and working memory, or from the table above for Glimmer's builds.

### Hosted, for development

| Provider | Id | Context | Price in / cached / out | Notes |
| --- | --- | --- | --- | --- |
| Together | `meta-models/Muse-Glimmer-30B` | 131,072, FP8 | $0.35 / $0.04 / $1.50 | Meta's page says generation stops at 32,768 tokens per request; OpenRouter lists 117,964 max completion for Together. Dedicated endpoints can return 503 for 10 to 15 minutes while warming. |
| OpenRouter | `meta/muse-glimmer-30b` | 131,072 | via DeepInfra $0.30 / $0.04 / $1.20, via Together $0.35 / $0.04 / $1.50 | DeepInfra max completion 16,384 (bf16). Parameters listed include `tools`, `tool_choice`, `response_format`, `structured_outputs`, `reasoning`, `reasoning_effort`, `top_k`, `min_p`. Reasoning text returns in `message.reasoning` and `reasoning_details`. |
| DeepInfra | `meta-models/Muse-Glimmer-30B` | 131,072 | $0.30 / $0.04 / $1.20 | Tools and JSON output listed. Max output not stated. |
| Fireworks | `accounts/fireworks/models/muse-glimmer-30b` | 131k | none published | Page lists Serverless "Not Supported". Its FAQ says deprecation applies "Only on serverless, starting on September 25, 2026", on-demand stays, and recommends Nemotron Lightning 3.5 30B A3B. A third-party tracker says Fireworks added it to serverless on 2026-08-14 at $0.35 / $0.04 / $1.50 (that page contradicts itself in its subtitle), so any serverless price is historical. |

Sources: https://docs.together.ai/docs/serverless-models, https://dev.meta.ai/docs/muse-glimmer/deploy, https://openrouter.ai/api/v1/models/meta/muse-glimmer-30b/endpoints, https://openrouter.ai/docs/guides/best-practices/reasoning-tokens, https://deepinfra.com/meta-models/Muse-Glimmer-30B, https://fireworks.ai/models/fireworks/muse-glimmer-30b, https://usagepricing.com/blueprint/activity/fireworks-ai-2026-08-14-packaging

- Hosted reasoning control is not uniform. DeepInfra and the Hugging Face card say to put `Reasoning strength: <value>` in the system prompt. OpenRouter lists `reasoning` and `reasoning_effort` for both its endpoints, but how they map to Glimmer's strength is unverified. Sources: https://deepinfra.com/meta-models/Muse-Glimmer-30B, https://openrouter.ai/api/v1/models/meta/muse-glimmer-30b/endpoints
- Together returns reasoning in `reasoning` or `reasoning_content` depending on the model. Source: https://docs.together.ai/docs/openai-api-compatibility
- A hosted Glimmer is a stand-in for the local one during development. Its quantization differs from the local Q4_K_M (Together serves FP8, DeepInfra bf16), so pass rates will not match exactly.

## Other mentors and connections

Meta stays the default. Every mentor below goes through the same loop, budget gate and lineage; only the request wording differs. Ids and prices live in `packages/shared/src/models.ts`.

### Connections and keys

- A hosted provider's key is stored encrypted under the provider's name and sent only to that provider's hosts, over HTTPS. A key for an endpoint the user adds by address is stored as `custom:<host[:port]>` and sent only to that exact host and port; plain HTTP is allowed only to this computer.
- Main checks a key before storing it: OpenRouter's `GET /key`, then the provider's model list. A refused key (401 or 403) is not stored. A list that is missing or unreadable doesn't block the key, since some OpenAI-compatible servers have no `/models`.
- Model lists: Anthropic's paged `GET /v1/models`, OpenRouter's public `GET /api/v1/models` (no key sent), Ollama's `GET /api/tags`, and `GET /models` for every other connection. Ids that are plainly not chat models (embeddings, speech, images and the like) are dropped; Gemini's `models/` prefix is removed. Presets come first and any typed id is allowed.
- On this computer, Ollama (`http://127.0.0.1:11434`) and LM Studio (`http://127.0.0.1:1234/v1`) are looked for with a short timeout, and Ollama's `GET /api/ps` says which models are loaded and how much of each is on the GPU.

### OpenAI

| Id | Price in / cached / out | Above 272K input tokens |
| --- | --- | --- |
| `gpt-6.1-sol` | $2 / $0.10 / $10 | $4 / $0.20 / $15 |
| `gpt-6-luna` | $0.10 / $0.01 / $0.50 | $0.20 / $0.02 / $0.75 |

Chat Completions on `https://api.openai.com/v1`, with the `developer` role, `max_completion_tokens`, `prompt_cache_key`, and `reasoning_effort` for reasoning models. Replies are held to the loop's schema with `response_format` `json_schema`, `strict: true` when the schema fits OpenAI's strict subset. Sources: https://developers.openai.com/api/docs/pricing, https://platform.openai.com/docs/pricing.

### Anthropic

| Id | Price in / cache read / out | Above 100K input tokens |
| --- | --- | --- |
| `claude-opus-5-5` | $4 / $0.20 / $20 | |
| `claude-sonnet-5-5` | $2 / $0.10 / $10 | |
| `claude-haiku-5-5` | $0.10 / $0.01 / $0.50 | $0.50 / $0.05 / $2.50 |

Its own adapter on the Messages API, `https://api.anthropic.com/v1/messages`, with `x-api-key` and `anthropic-version: 2026-10-21`, streamed. The model's entry in `GET /v1/models/{id}`, read once, says what it takes: `capabilities.structured_outputs` and `capabilities.effort`. With structured outputs the reply is held to the schema by `output_config.format` (`json_schema`); a model without them gets a forced tool call (`tool_choice` of type `tool`), and a schema structured outputs can't express goes in the prompt with one repair call. `output_config.effort` is sent only to models whose entry lists it. A refusal (`stop_reason: "refusal"`) ends the call as blocked, with what it cost counted. Sources: https://platform.claude.com/docs/en/about-claude/pricing, https://platform.claude.com/docs/en/models/overview, https://platform.claude.com/docs/en/api/versioning, https://platform.claude.com/docs/en/api/migration-2026-10-21, https://platform.claude.com/docs/en/build-with-claude/refusals-and-fallback.

### Google Gemini

| Id | Price in / cached / out | Above 200K input tokens |
| --- | --- | --- |
| `gemini-3.1-pro-preview` | $2 / $0.20 / $12 | $4 / $0.40 / $18 |
| `gemini-3.5-flash-lite` | $0.30 / $0.03 / $2.50 | |

Through Google's OpenAI-compatible endpoint, `https://generativelanguage.googleapis.com/v1beta/openai`, with the `system` role, `max_tokens`, `reasoning_effort`, and `response_format` `json_schema`. Sources: https://ai.google.dev/gemini-api/docs/openai, https://ai.google.dev/gemini-api/docs/pricing.

### OpenRouter

- Any model in its catalogue. `GET /api/v1/models` is public and gives prices per token; Architect converts them to per million, takes the highest of a model's time-of-day prices, and treats a `min_prompt_tokens` price as the long-prompt rate.
- The listed price is saved with the mentor and sent with every call as `provider.max_price`, so OpenRouter can't route to a provider that charges more than the spending cap was computed at. When a reply reports `usage.cost`, that is the amount charged against the cap. Sources: https://openrouter.ai/docs/guides/routing/provider-selection, https://openrouter.ai/docs/guides/guides/usage-accounting.
- Reasoning is set with `reasoning: {"effort": ...}`. The schema goes in `response_format` and in the prompt too, because OpenRouter passes `response_format` only to providers that support it.
- Requests carry `HTTP-Referer` and `X-Title` so OpenRouter can credit the app.
- Sign in with OpenRouter uses its PKCE flow for apps with no server. Main opens `https://openrouter.ai/auth?callback_url=http://127.0.0.1:<port>/callback&code_challenge=<S256 of a random verifier>&code_challenge_method=S256&state=<random>&key_label=Architect` in the system browser and listens once on 127.0.0.1 for the callback. OpenRouter documents `callback_url` as taking "localhost/127.0.0.1 URLs on any port", and returns `state` unchanged when the user approves (not when they decline), so a callback with another `state` is ignored and one with no `code` counts as declined. The code is exchanged with `POST https://openrouter.ai/api/v1/auth/keys` (`code`, `code_verifier`, `code_challenge_method`), and the key that comes back is stored like a pasted one. Codes expire after 10 minutes, which is also how long Architect waits. Sources: https://openrouter.ai/docs/use-cases/oauth-pkce, https://openrouter.ai/docs/guides/overview/auth/oauth.md, https://www.openrouter.ai/docs/api/api-reference/oauth/create-authorization-code.md, https://openrouter.ai/docs/api/api-reference/o-auth/exchange-auth-code-for-api-key.md.

### Other OpenAI-compatible services

Groq, Together, DeepInfra and Fireworks have named connections; anything else (a vLLM server, another host) is added by its address. These get the `system` role, `max_tokens` (Groq: `max_completion_tokens`), no reasoning control, and the schema in the prompt with one repair call. None has preset mentor prices, so a model from one needs a price entered before training (decision 034). Groq keeps the schema in the prompt because its Chat Completions can't stream a reply held to a schema (unverified; not checked live, no key).

### Models on this computer

Ollama's OpenAI-compatible endpoint (`/v1` under its usual address) and LM Studio's both take `response_format` `json_schema`. They need no key, cost nothing, and count as free against the spending cap. A mentor on this computer runs only while training; a graduate never calls any mentor (invariant 3).

### Students beyond Glimmer

- Any Ollama model, listed with its size and whether it fits the GPU, or pulled by name. `think` is sent as a level only where `POST /api/show` lists that level under `thinking`, as `true` for models that think but list no levels, and not at all for models without the `thinking` capability.
- Any OpenAI-compatible server on this computer (LM Studio, llama.cpp, vLLM). A graduate runs only on loopback addresses.
- A hosted copy for faster practice from OpenRouter, Together, DeepInfra, Groq, Fireworks or an added endpoint. OpenRouter's listed price is saved with it for the estimates. Groq is sent tool messages without a `name` field, which it is said to reject (unverified). The locked test and every chat still run on this computer.

### Live checks, 2026-10-28

One small call per adapter with a real key (keys from the owner's store, never printed), each asked for a short JSON object and checked against the schema.

| Mentor | Model | Result | Time | Tokens in / out | Cost |
| --- | --- | --- | --- | --- | --- |
| Meta, contributor tier | `muse-spark-1.3-contributor` | JSON matched | 1,820 ms | 65 / 183 (169 reasoning) | $0.000043 |
| OpenAI | `gpt-6-luna` | JSON matched | 7,813 ms | 47 / 11 | $0.000010 |
| Anthropic, structured outputs | `claude-haiku-5-5` | JSON matched | 930 ms | 217 / 9 | $0.000026 |
| Anthropic, forced tool call (capabilities overridden to force that path) | `claude-haiku-5-5` | JSON matched | | 524 / 33 | $0.000069 |
| Google Gemini | `gemini-3.5-flash-lite` | JSON matched | 748 ms | 15 / 9 | $0.000027 |
| OpenRouter, a free model (the account has no credit) | `nvidia/nemotron-3.5-super-vl:free` | JSON matched | 1,387 ms | 113 / 96 | $0 reported |
| Ollama on this computer, through `/v1` | `granite4.2:8b` | JSON matched | 21.6 s, including loading the model | | free |

A student chat on `granite4.2:8b` through Ollama with `think: true` answered in 670 ms with 40 reasoning tokens; the model was unloaded at once (`keep_alive: 0`) and `GET /api/ps` was empty afterwards. Model lists read the same day: Meta 7, OpenAI 83, Anthropic 14, Gemini 26, OpenRouter 448 (441 with prices), Ollama 9.

Not checked live: the OpenRouter sign-in in a real browser (unit tests cover the PKCE values, the callback, the exchange, cancel and timeout), LM Studio (not installed here), Groq, Together, DeepInfra and Fireworks as mentors (no keys), OpenRouter's paid models (no credit), and the GPU-sized build's full install (fakes only, while GPU work is paused).

## Adapter configuration notes

### What each adapter needs

| Adapter | Base URL | Model id | Auth header | Protocol |
| --- | --- | --- | --- | --- |
| Meta (mentor) | `https://api.meta.ai/v1` | `muse-spark-1.3` or `muse-spark-1.3-contributor` | `Authorization: Bearer <key>` | Chat Completions, or Responses for multi-step reasoning |
| Spark Open on Baseten (mentor) | `https://inference.baseten.co/v1` | `meta-models/muse-spark-open-1026` (partner notes) | `Authorization: Bearer <key>` | Chat Completions |
| Spark Open on Modal (mentor) | `https://inference.us-west.modal.direct/v1` (confirm) | from `GET /v1/models` on the endpoint | `Authorization: Bearer wk-<id>.ws-<secret>` | Chat Completions |
| Ollama (student) | `http://127.0.0.1:11434` | `muse-glimmer:30b` | none on `/api/chat`; `Authorization: Bearer ollama` on `/v1` | native `/api/chat` preferred |
| llama.cpp (student, small quant) | `http://127.0.0.1:8080/v1` | `muse-glimmer` (the `-a` value) | `Authorization: Bearer <value of --api-key>` when started with it | Chat Completions |
| Together (student, development) | `https://api.together.ai/v1` | `meta-models/Muse-Glimmer-30B` | `Authorization: Bearer <key>` | Chat Completions |
| OpenRouter (student, development) | `https://openrouter.ai/api/v1` | `meta/muse-glimmer-30b` | `Authorization: Bearer <key>`; optional `HTTP-Referer` and `X-OpenRouter-Title` | Chat Completions |
| DeepInfra (student, development) | `https://api.deepinfra.com/v1/openai` | `meta-models/Muse-Glimmer-30B` | `Authorization: Bearer <key>` | Chat Completions |
| OpenAI (mentor) | `https://api.openai.com/v1` | `gpt-6.1-sol`, `gpt-6-luna`, or any listed id | `Authorization: Bearer <key>` | Chat Completions |
| Anthropic (mentor) | `https://api.anthropic.com/v1` | `claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5`, or any listed id | `x-api-key: <key>` and `anthropic-version: 2026-10-21` | Messages, streamed |
| Google Gemini (mentor) | `https://generativelanguage.googleapis.com/v1beta/openai` | `gemini-3.1-pro-preview`, `gemini-3.5-flash-lite`, or any listed id | `Authorization: Bearer <key>` | Chat Completions |
| OpenRouter (mentor, or hosted student) | `https://openrouter.ai/api/v1` | any id from `GET /models` | `Authorization: Bearer <key>`, with `HTTP-Referer` and `X-Title` | Chat Completions |
| Added endpoint (mentor, or hosted student) | the address entered | any id | `Authorization: Bearer <key>` when it has a key | Chat Completions |
| Ollama (mentor) | `http://127.0.0.1:11434`, with `/v1` added | any installed model | none | Chat Completions |
| LM Studio (mentor or student) | `http://127.0.0.1:1234/v1` | any loaded model | none | Chat Completions |

Sources: the sections above.

### Meta adapter rules

- Set `max_completion_tokens` with room for reasoning. Read reasoning cost from `completion_tokens_details.reasoning_tokens`; bill it as output.
- Send `reasoning_effort` from `minimal` to `xhigh` only. Never `none`. Send `max` only on the non-contributor id, and try it once before depending on it.
- Omit `tool_choice` (the only accepted value is `auto`). Omit `stop`, `logprobs`, `n`, `logit_bias`, `frequency_penalty`, `presence_penalty`. Do not send `top_p: 0`. Leave temperature and top_p at their defaults unless there is a reason.
- Add `stream_options: {"include_usage": true}` when streaming Chat Completions, or the final usage is missing.
- Chat Completions never returns reasoning text and drops reasoning between turns. Use Responses (`reasoning.summary`, `previous_response_id` or encrypted reasoning with `store: false`) when the mentor loop needs either. Set `store: false` if stored responses are not acceptable.
- Show the tier in Settings with its consequences: 150 RPM, no `max` effort, content may train Meta's models, and no sensitive, confidential or personal data.
- Retry 429 and 500 with backoff and jitter, honor `Retry-After` on 429 and 503, never retry 400, 401, 402, 403, 404 or 413, and stream or use background mode instead of repeating a 504.
- Set `prompt_cache_key` to a stable string and keep the system prompt and tool definitions first.

### Spark Open adapter rules

- Baseten: do not send `response_format` or JSON mode. Ask for structured results through tool calls or the `ANSWER: <json>` line already used for task answers. Always set `max_tokens` (the default of 4096 includes reasoning). Set `reasoning_effort` explicitly; the default `xhigh` is the slowest. Keep `n` at 1. Do not rely on `seed` or `temperature: 0` for repeatability.
- Parse `message.reasoning_content` when present, and also `message.reasoning`, because the streaming field name is undocumented for Baseten and Modal. Never depend on it for correctness.
- Stream long generations so proxies and clients do not time out; Meta recommends it for reasoning-heavy work.
- Baseten rate limits depend on the account tier (15 RPM and 100,000 TPM when unverified). Read the effective limits from `GET /v1/model_apis/{model_api_name}`. Retry 429, 500 and 529.
- Modal: create the endpoint and a proxy token first, read `GET <endpoint-url>/v1/models` for the `model` value, and send `Modal-Routing-Affinity-Key` per job to keep one conversation on one container.
- Before shipping the Baseten id, confirm `meta-models/muse-spark-open-1026` appears in `GET /v1/models` for the key. If it does not, the public id is `meta-models/muse-spark-open`.

### Student adapter rules

- Ollama: pass `options.num_ctx` on every native request (the default is 4k under 24 GiB VRAM), and `options.num_predict` high enough for reasoning. Prefer `/api/chat` over `/v1`: it takes `num_ctx`, has `think` levels, and returns `message.thinking`.
- Use `think` values `"low"`, `"medium"` or `"high"`. Treat `"max"` as unverified, since Meta's top level is `xhigh`. Query `POST /api/show` at runtime for the values the installed Ollama reports.
- Do not use `think: false` together with a JSON schema `format` until Ollama pull request 18687 is merged.
- `tool_choice` does not exist on Ollama `/v1`, and `/v1` takes base64 images only.
- Return tool results with `role: "tool"` and `tool_name`. Treat parallel tool calls as unreliable (see the chat template section).
- Student sampling per Meta is temperature 1.0, top_p 0.95, top_k 64. Ollama's `params` blob already sets them. Overrides that change them, such as temperature 0, are outside Meta's guidance.
- `thinking: off` in `decoding.yaml` has no true equivalent for Glimmer. It can map to `think: false` (reasoning hidden, probably still generated) or to `"low"`.
- llama.cpp: start with `--jinja`, `-a muse-glimmer`, `-ngl 99`, a `-c` that matches `-np`, and `--chat-template-kwargs '{"reasoning_strength":"low"}'`, then read `reasoning_content`. The uploaders of the 2-bit and 3-bit files (Unsloth, bartowski) document llama.cpp for them, and Meta documents its tool parser as selected automatically.
- Hosted student endpoints are for development only. Locked tests run on the local student (decision 009).

### How Architect's defaults follow from this

- Harness decoding defaults to Meta's Glimmer sampling (temperature 1, top_p 0.95, top_k 64) at `thinking: low` with 2,048 max output tokens, which leaves room for low-strength reasoning. The runner, not the harness, picks the sampler seed (decisions 007 and 015 in `DECISIONS.md`).
- Mentor reasoning effort is `low`, `medium` or `high`. Spark Open's server default is `xhigh`, the slowest, so the adapter always sends the configured level.

## Open questions

1. `meta-models/muse-spark-open-1026` is not on any public page. Confirm it with `GET /v1/models` on the Baseten key, and ask what differs from `meta-models/muse-spark-open`.
2. Does `reasoning_effort: "max"` work on `muse-spark-1.3` Chat Completions? Meta's guide and schema disagree.
3. Does Ollama `think: false` reduce Glimmer's generated tokens, or only hide them? One local run comparing `eval_count` with `think: false` and `think: "low"` answers it. Not done; this research was web-only.
4. What does `think: "max"` do on Ollama, and does Glimmer treat "max" as `xhigh`? Until measured, `high` is the top level to use.
5. Does tool calling and thinking separation work for a 2-bit GGUF imported into Ollama from Hugging Face, without the official `glimmer` renderer and parser? llama.cpp with `--jinja` is the route the uploaders and Meta document. Architect sidesteps it: its GPU-sized build is made with the `glimmer` renderer and parser (see "The GPU-sized build in Ollama"), and Ollama reports `tools` and `thinking` for it.
6. Tool-calling quality below 4-bit has no published number except one uploader's KL divergence table. Run the sample job on the 10 to 11 GB files before adopting one, and measure real VRAM and speed on the 12 GB card.
7. Parallel tool calls on Glimmer: Meta's prompting page says unsupported; the template and cookbook render several. Which does the harness need?
8. Spark Open license: read the gated `LICENSE.md`. Does choosing Spark Open as mentor in Architect trigger the "Built with Muse Spark Open" display requirement?
9. Data retention for the Standard tier is not stated in days anywhere public, and `store` defaults to true on Responses. Decide whether Architect sends `store: false`.
10. Baseten Model APIs: is `top_k` 50 applied to Spark Open, is `max_completion_tokens` accepted, and what is the streaming reasoning field name?
11. Modal: which of the dashboard's `model` value and the endpoint hostname does a Muse Spark Open shared endpoint expect? Also its rate limits and whether `response_format` works.
12. Fireworks: the model page says serverless is gone for Glimmer, but a tracker listed it in August. Check `GET https://api.fireworks.ai/inference/v1/models` with a key before ruling it out.
13. Together's Glimmer output cap: 32,768 (Meta's page) or 117,964 (OpenRouter's listing)? Use 32,768 until known. Together's docs use `api.together.ai`; Meta's page uses `api.together.xyz`.
14. Muse Spark 1.3 audio: Meta says quality may be degraded and suggests 1.2. Architect's current page lists audio as input without that caveat.
15. Groq, Together, DeepInfra and Fireworks as mentors have had no live call (no keys). Do any of them hold replies to a schema well enough to move them off the prompt-and-repair path?
16. LM Studio has had no live call (not installed on the development machine).
17. The OpenRouter sign-in has been tested against a fake OpenRouter only. Click through it once with a real account.
18. The GPU-sized build has been installed end to end only with fakes. Run the real install once GPU work is back on, then the sample job on it (open question 6).
