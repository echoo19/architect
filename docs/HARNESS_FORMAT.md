# Harness and graduate format

A harness is a plain folder, so it can be read, diffed, imported, improved and exported without Architect. A graduate is a harness folder plus the files that pin it to a model and record how it was made.

Format version: **1**. `@architect/harness` reads, writes, validates, diffs and versions these folders; the zod schemas in `@architect/shared` are the source of truth, and this page describes them.

## Harness folder

```
harness.yaml          format version, name, version number, parent version, content hash
system.md             the system prompt: role, scope, operating rules
skills/<slug>.md      step-by-step procedures, one per task type or sub-procedure
tools/<name>.json     a tool's manifest: name, description, JSON Schema for its arguments
tools/<name>.js       the tool's code: defines `function run(args, ctx)`
examples/<slug>.json  corrected traces used as few-shot examples
retrieval.yaml        which skills and examples load for which request
decoding.yaml         temperature, top_p, seed, max steps, max output tokens, thinking
guardrails.yaml       task types the agent refuses, each with the reason
```

Everything except `harness.yaml` and `system.md` is optional. A blank harness is just those two files.

### harness.yaml

```yaml
format: 1
name: Service desk
version: 7          # increases by one for every kept or candidate change
parent: 6           # the version this one was derived from; absent for the first
hash: sha256-...    # over the normalized contents of every other file
```

### skills/<slug>.md

Markdown with a small front matter block. The agent sees each skill's name and summary in its system prompt and loads the full text with the built-in `load_skill` tool, unless a retrieval rule loads it automatically.

```markdown
---
name: Price a completed job
summary: Turn a completed job into invoice lines and a total in cents.
task_types: [invoice]
---
1. Read the job with read_table ...
```

### tools/<name>.json and tools/<name>.js

```json
{ "name": "invoice_total", "description": "Total an invoice in cents from its lines.",
  "parameters": { "type": "object", "properties": { "lines": { "type": "array" } }, "required": ["lines"] } }
```

```js
function run(args, ctx) {
  // ctx.readTable(name, { where, columns, limit }), ctx.readText(name), ctx.listFiles()
  return { total_cents: 0 };
}
```

Tools run in a QuickJS sandbox with no network, no clock and no randomness. `ctx` exposes only the job's declared files, read-only. A tool returns JSON-serializable data; a thrown error comes back to the agent as a tool error.

### examples/<slug>.json

```json
{ "title": "After-hours job with a plan member",
  "task_types": ["invoice"],
  "messages": [ { "role": "user", "content": "..." }, { "role": "assistant", "content": "...", "tool_calls": [] }, { "role": "tool", "name": "read_table", "content": "..." } ] }
```

### retrieval.yaml

```yaml
list_skills: true            # put each skill's name and summary in the system prompt
max_loaded_skills: 2
max_examples: 2
rules:
  - when_any: [invoice, bill, price the job]
    load_skills: [price-a-job]
    load_examples: [after-hours-plan-member]
```

`when_any` matches case-insensitive words or phrases in the request. Rules apply in order until the caps are reached.

### decoding.yaml

```yaml
temperature: 0
top_p: 1
seed: 7
max_steps: 8
max_output_tokens: 1024
thinking: off        # off | low | high, when the student supports it
```

### guardrails.yaml

```yaml
refuse:
  - task_type: scheduling
    when_any: [book, schedule, appointment]
    reason: Scheduled jobs in testing chose a valid slot only 60% of the time.
```

A request that matches a refusal rule gets a refusal with the reason, before the student is called.

## Graduate folder

```
graduate.yaml     name, job, pinned student (runtime, model id, quantization, digest), harness version and hash,
                  requirements and whether each was met, test results summary, mentor used, created date
report.md         the report card
lineage.jsonl     one line per hypothesis: round, files changed, diagnosis, cause, predicted and measured effect, decision
(the harness files above)
```

## Versioning, import and export

- Every candidate change produces a new version folder; reverted versions are kept for the lineage but are never a parent of a kept version.
- `hash` changes whenever any file changes, so a graduate's harness can be verified against its `graduate.yaml`.
- Import accepts any folder that validates; missing optional files are treated as empty. Export writes the folder as-is (zip on request).
