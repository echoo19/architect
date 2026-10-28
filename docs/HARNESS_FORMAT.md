# Harness and graduate format

A harness is a plain folder, so it can be read, diffed, imported, improved and exported without Architect. A graduate version is a package: a harness folder plus the files that pin it to a model and record how it was made.

Harness format: **1**. Graduate package format: **2**. `@architect/harness` reads, writes, validates, diffs and versions these folders; the zod schemas in `@architect/shared` are the source of truth, and this page describes them.

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
  "messages": [
    { "role": "user", "content": "..." },
    { "role": "assistant", "content": "", "tool_calls": [ { "id": "call_1", "name": "read_table", "arguments": { "file": "jobs.csv" } } ] },
    { "role": "tool", "tool_call_id": "call_1", "name": "read_table", "content": "..." } ] }
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
temperature: 1       # Meta's recommended sampling for Glimmer
top_p: 0.95
top_k: 64
max_steps: 16
max_output_tokens: 4096   # includes reasoning tokens
thinking: low        # low | medium | high reasoning strength
```

The sampler seed is deliberately absent: the runner chooses it for every evaluation, so a harness change can't re-roll its own results.

### guardrails.yaml

```yaml
refuse:
  - task_type: scheduling
    when_any: [book, schedule, appointment]
    reason: Scheduled jobs in testing chose a valid slot only 60% of the time.
```

A request that matches a refusal rule gets a refusal with the reason, before the student is called.

## Graduate package (format 2)

A graduate is an agent with immutable versions. Each version is a package: a plain folder, and the same files in a ZIP named `<name>-v<n>.architect.zip` for moving it. The desktop app, export, import and (later) the CLI and the Hub all use this one artifact (decisions 036 and 037).

```
graduate.json          the manifest: everything below, and the sha256 of every other file
harness/               the harness folder above, as @architect/harness writes it
evidence/report.json   the author's report card (snake_case keys), for the app
evidence/report.md     the same report card for people
evidence/lineage.jsonl each round's title, files, predicted and measured effect and decision;
                       without the mentor's diagnosis, its reasoning or the task ids behind it
adapter/...            a LoRA adapter, when the version has one
resources/<name>/...   a resource's files, only when the author chose to share them
```

Nothing in a package belongs to one computer: no model endpoint, folder, chat or key. Those are the installation's (below).

### graduate.json

```json
{
  "schema": 2,
  "kind": "architect.graduate",
  "identity": { "agent_id": "grd_...", "name": "Service desk", "version": 2,
                "parent": { "agent_id": "grd_...", "version": 1, "digest": "..." },
                "created_at": "2026-11-05T18:00:00.000Z", "method": "architect" },
  "contract": { "version": 1, "job_id": "...", "capabilities": {...}, "inputs": {...},
                "outputs": {...}, "boundaries": {...}, "acceptance": { "pass_rate": 0.95 } },
  "model": { "label": "Glimmer",
             "base": { "name": "muse-glimmer:30b", "digest": "sha256:...", "quantization": "Q4_K_M" },
             "adapter": { "path": "adapter/adapter.gguf", "format": "gguf_lora", "sha256": "...", "size_bytes": 0 },
             "inference": { "context_length": 16384 },
             "runtime": { "compatible": ["ollama", "openai_compatible", "llama.cpp"] } },
  "harness": { "format": 1, "path": "harness", "hash": "sha256-...", "version": 7, "round": 3 },
  "resources": [ { "name": "data", "kind": "folder", "required": true, "accepts": ["text/csv"],
                   "access": "read_write", "files": [ { "name": "invoices.csv", "kind": "table",
                   "access": "write", "columns": ["invoice_id", "..."] } ] } ],
  "requirements": { "tested": [ { "os": "win32", "arch": "x64", "backend": "ollama", "target": "local" } ],
                    "measured": { "latency_ms": { "p50": 9000, "p95": 21000 } },
                    "minimum": { "memory_bytes": 0 }, "limitations": [ "..." ] },
  "evidence": { "label": "Evaluated on the author's configuration", "status": "ready",
                "contract_version": 1, "summary": {...}, "counts": {...}, "provenance": {...},
                "files": { "report": "evidence/report.json", "...": "..." } },
  "verification": { "checks": [ { "id": "harness-valid", "kind": "harness_valid", "description": "..." } ],
                    "fixtures": [] },
  "integrity": { "algorithm": "sha256", "files": [ { "path": "harness/system.md", "sha256": "...", "size": 0 } ] },
  "terms": { "base_model": "Uses muse-glimmer:30b, which isn't included...", "notices": [ "..." ] }
}
```

- **identity**: the agent's id stays the same across versions; `parent` names the version this one was derived from.
- **contract**: the job contract it was tested against (`JobContractSchema`). A change to a job's scope or success criteria makes a new contract version, and a result measured under one never counts for another.
- **model**: the base weights named the way runtimes name them and pinned by digest (or a hub revision); never the weights themselves. A harness-only graduate runs on any local runtime that serves its base; one with an adapter only on a runtime that loads adapters (llama.cpp).
- **resources**: logical folders the graduate works in. `data` holds the files the contract names; `output` is for new files. Each installation binds them to its own folders, and `access` is a request, not a grant.
- **evidence**: the author's results, labelled as such. Its `status` is `ready` only when the locked test met the contract's bar on a local student.
- **verification**: checks any installation can run without private data. Never the locked test.
- **integrity**: every file but `graduate.json`, in path order. The version's identity is the sha256 of `graduate.json` itself.

### Rules for files in a package

Paths are relative with forward slashes. Every segment starts with a letter or digit and holds only letters, digits, `.`, `_`, `-` and spaces; no segment is `..`, ends in a dot or space, or is a Windows device name (`con`, `nul`, `com1`...); no two paths differ only in letter case. Only plain files and folders: links, junctions and special files are refused. At most 2,000 files, 2 GB a file and 4 GB in all. Archives are stored or deflated, UTF-8 named, unencrypted and without ZIP64. What file managers leave behind (`.DS_Store`, `._` files, `__MACOSX`, `Thumbs.db`, `desktop.ini`) is passed over and never counts as part of a package.

### Installation

A computer keeps, for each agent, an installation in its own database, never in a package: the local model endpoint (runtime, address, the name it serves the base under), a folder for each logical resource, and the grants (write mode, and `none`, `read` or `read_write` for each resource). A graduate made on the computer gets its job's endpoint, a copy of the job's data for `data/` and the job's write mode. An imported one gets only what the import names. Each version's last installation checks (platform, memory, runtime and adapter fit, harness hash, tools load, folders and their columns, model served and the same build, a short request) are stored with it under the label "Installation checks on this computer", apart from the author's evidence: ready, needs attention, or blocked.

## Format 1 graduate folders

Graduates made before versions were one folder: the harness files, `graduate.yaml` (name, job, run, the pinned student with its endpoint, harness version and hash, requirements, test summary, mentor), `report.json`, `report.md` and `lineage.jsonl`. Architect reads them and converts each to version 1 of a package: graduates already on a computer when it starts (their endpoint becomes the installation; the old files stay), and folders being imported.

## Versioning, import and export

- Every candidate change to a harness during training produces a new harness version folder; reverted ones are kept for the lineage but are never a parent of a kept one.
- `hash` changes whenever any harness file changes, so a package's harness can be checked against its manifest.
- Export writes `<name>-v<n>/` and `<name>-v<n>.architect.zip`: the version's folder byte for byte, plus a resource's files only when chosen. Import accepts either, checks all of it before anything runs, and installs it as a new local version; the same version twice is found, never installed again. A package joins an agent already here only when that agent has the version it names as parent, by digest; otherwise it becomes an agent of its own.
