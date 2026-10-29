# Harness and graduate format

A harness is a plain folder, so it can be read, diffed, imported, improved and exported without Architect. A graduate version is a package: a harness folder plus the files that pin it to a model and record how it was made.

Harness format: **2**. Graduate package format: **2**. `@architect/harness` reads, writes, validates, diffs and versions these folders; the zod schemas in `@architect/shared` are the source of truth, and this page describes them. Harness format 1 folders still load (see the end of this page).

## Harness folder

```
harness.yaml               format version, name, version number, parent version, content hash
AGENTS.md                  the standing instructions: role, scope, operating rules
skills/<name>/SKILL.md     a procedure the agent reads when a request calls for it
tools/<name>.json          a helper tool's manifest: name, description, JSON Schema for its arguments
tools/<name>.js            the helper's code: defines `function run(args, ctx)`
examples/<slug>.json       corrected traces used as few-shot examples
retrieval.yaml             which skills and examples load for which request
decoding.yaml              temperature, top_p, top_k, max steps, max output tokens, thinking
guardrails.yaml            task types the agent refuses, each with the reason
```

Everything except `harness.yaml` and `AGENTS.md` is optional. A blank harness is just those two files.

### harness.yaml

```yaml
format: 2
name: Service desk
version: 7          # increases by one for every kept or candidate change
parent: 6           # the version this one was derived from; absent for the first
hash: sha256-...    # over the normalized contents of every other file
```

### AGENTS.md

The standing instructions. They open the agent's system prompt, followed by the date, the agent's files, its skills by name and description, and whatever the retrieval rules load.

### skills/<name>/SKILL.md

Markdown with a small front matter block. `name` is the folder's name (lowercase letters, digits and dashes); `description` says what the skill is for. The agent sees every skill's name and description in its system prompt and reads the whole file with `read` when it needs the steps, unless a retrieval rule puts the steps in the prompt up front. A skill folder holds only `SKILL.md`.

```markdown
---
name: price-a-job
description: Turn a completed job into invoice lines and a total in cents.
---
1. Find the job's line with grep in data/jobs.csv ...
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

Helpers run in a QuickJS sandbox with no network, no clock and no randomness. `ctx` exposes only the job's declared data files, read-only, by name (`jobs.csv`, or `data/jobs.csv`). A helper returns JSON-serializable data; a thrown error comes back to the agent as a tool error. A helper can't have the name of a built-in tool.

### examples/<slug>.json

```json
{ "title": "After-hours job with a plan member",
  "task_types": ["invoice"],
  "messages": [
    { "role": "user", "content": "..." },
    { "role": "assistant", "content": "", "tool_calls": [ { "id": "call_1", "name": "grep", "arguments": { "pattern": "^W-2482,", "path": "data/jobs.csv" } } ] },
    { "role": "tool", "tool_call_id": "call_1", "name": "grep", "content": "..." } ] }
```

### retrieval.yaml

```yaml
list_skills: true            # put each skill's name and description in the system prompt
max_loaded_skills: 2
max_examples: 2
rules:
  - when_any: [invoice, bill, price the job]
    load_skills: [price-a-job]
    load_examples: [after-hours-plan-member]
```

`when_any` matches case-insensitive words or phrases in the request. `load_skills` names skills by their folder. Rules apply in order until the caps are reached.

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

`max_output_tokens` also sets how much of the model's context is kept free for each reply, at most a quarter of the context; a prompt may take the rest, and when a conversation would pass it, the oldest tool results are replaced by a note that says what they were (decision 057). With a 16,384-token context and 4,096 here, a prompt has 12,288 tokens.

### guardrails.yaml

```yaml
refuse:
  - task_type: scheduling
    when_any: [book, schedule, appointment]
    reason: Scheduled jobs in testing chose a valid slot only 60% of the time.
```

A request that matches a refusal rule gets a refusal with the reason, before the student is called.

## The agent's folder and tools

The harness runs on a coding agent's tools over a folder of logical paths; the agent never sees a path on the computer.

```
data/<file>           the job's declared data files; the job says which ones may change
output/               a folder for new files, when the job allows one (data.output in job.json)
skills/<name>/SKILL.md  the harness's skills, read-only
```

| Tool | What it does |
| --- | --- |
| `read(path, offset?, limit?)` | A file's lines, numbered (line number, tab, text), up to 200 lines or 8,000 characters at a time; the last line says how many lines are left and the offset to read on from. |
| `ls(path?)` | A folder's files with their kind (table or text), size in lines and whether the agent may change them; the top folders when no path is given. |
| `glob(pattern)` | Paths that match a pattern; a pattern without `/` matches file names in any folder. |
| `grep(pattern, path?, glob?, ignore_case?, limit?)` | Lines that match a regular expression, as `path:line: text`, 50 by default and 200 at most, with a count of the rest. The search runs in the sandbox, so a runaway pattern is stopped. |
| `write(path, content)` | Replaces a file the agent may change, or creates one in `output/`. |
| `edit(path, old_string, new_string, replace_all?)` | Replaces exact text, which must match once unless `replace_all` is set. |
| `append(path, text)` | Adds lines at the end of a file. |
| `run(code)` | JavaScript in the QuickJS sandbox, with `files.read`, `files.list`, `csv.parse`, `csv.stringify`, `print`, `console.log` and `today` (the job's business date). No network, no clock, no randomness, a time and memory limit, and no way to change a file. It returns what the code printed and `=> ` the JSON of its last value, both capped. |

The three write tools go through the job's write permissions, and in the workspace through the user's approval (ask, allow or never); every change is diffed by line, and a change to a table also by row. A table must stay valid CSV with its header line. During training each attempt works on its own scratch copy; in the workspace `data/` and `output/` are the folders the graduate's installation on this computer binds (below).

## Graduate package (format 2)

A graduate is an agent with immutable versions. Each version is a package: a plain folder, and the same files in a ZIP named `<name>-v<n>.architect.zip` for moving it. The desktop app, export, import, the `architect` command and Hugging Face all use this one artifact (decisions 038, 039, 043 and 044).

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
             "adapter": { "path": "adapter/adapter.gguf", "format": "gguf_lora", "sha256": "...", "size_bytes": 0,
                          "base_digest": "sha256:...", "scale": 1, "training_job_id": "trn_..." },
             "inference": { "context_length": 16384 },
             "runtime": { "compatible": ["ollama", "openai_compatible", "llama.cpp"] } },
  "harness": { "format": 2, "path": "harness", "hash": "sha256-...", "version": 7, "round": 3 },
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
  "integrity": { "algorithm": "sha256", "files": [ { "path": "harness/AGENTS.md", "sha256": "...", "size": 0 } ] },
  "terms": { "base_model": "Uses muse-glimmer:30b, which isn't included...", "notices": [ "..." ] }
}
```

- **identity**: the agent's id stays the same across versions; `parent` names the version this one was derived from.
- **contract**: the job contract it was tested against (`JobContractSchema`). A change to a job's scope or success criteria makes a new contract version, and a result measured under one never counts for another.
- **model**: the base weights named the way runtimes name them and pinned by digest (or a hub revision); never the weights themselves. A harness-only graduate runs on any local runtime that serves its base; one with an adapter only on a runtime that loads adapters (llama.cpp). An adapter is a GGUF LoRA named as the adapter runtime loads it (decision 038): its file's sha256, which the integrity section must list the same; `base_digest`, the digest of the base's GGUF file in Ollama's store, the only build it loads on; the `scale` every request applies; and the training job that made it, with `stand_in` when the stand-in backend built it.
- **harness**: the harness folder's format and hash, and the round that made it. A harness migrated from an older format has the migrated files and hash, and `migrated_from` keeps the format and hash it was tested with (decision 040).
- **resources**: logical folders the graduate works in. `data` holds the files the contract names; `output` is for new files. Each installation binds them to its own folders, and `access` is a request, not a grant.
- **evidence**: the author's results, labelled as such. Its `status` is `ready` only when the locked test met the contract's bar on a local student.
- **verification**: checks any installation can run without private data. Never the locked test.
- **integrity**: every file but `graduate.json`, in path order. The version's identity is the sha256 of `graduate.json` itself.

### Rules for files in a package

Paths are relative with forward slashes. Every segment starts with a letter or digit and holds only letters, digits, `.`, `_`, `-` and spaces; no segment is `..`, ends in a dot or space, or is a Windows device name (`con`, `nul`, `com1`...); no two paths differ only in letter case. Only plain files and folders: links, junctions and special files are refused. At most 2,000 files, 2 GB a file and 4 GB in all. Archives are stored or deflated, UTF-8 named, unencrypted and without ZIP64. What file managers leave behind (`.DS_Store`, `._` files, `__MACOSX`, `Thumbs.db`, `desktop.ini`) is passed over and never counts as part of a package.

### Installation

A computer keeps, for each agent, an installation in its own database, never in a package: the local model endpoint (runtime, address, the name it serves the base under), a folder for each logical resource, and the grants (write mode, and `none`, `read` or `read_write` for each resource). A graduate made on the computer gets its job's endpoint, a copy of the job's data for `data/` and the job's write mode. An imported one gets only what the import names. Each version's last installation checks (platform, memory, runtime and adapter fit, harness hash, tools load, folders and their columns, model served and the same build, a short request) are stored with it under the label "Installation checks on this computer", apart from the author's evidence: ready, needs attention, or blocked.

### On Hugging Face

A published version is a model repository holding the package at its root, exactly as an export writes it, and a `README.md` model card made from its manifest beside it. The package goes up in one commit, which the card names in its install command (`architect install hf://owner/name --revision <commit>`); the card follows in a second commit. Installing fetches `graduate.json` at one commit and then only the files it lists, each checked against its sha256 and size, so the card and any other file in the repository never reach a computer that installs it (decision 044).

## Format 1 graduate folders

Graduates made before versions were one folder: the harness files, `graduate.yaml` (name, job, run, the pinned student with its endpoint, harness version and hash, requirements, test summary, mentor), `report.json`, `report.md` and `lineage.jsonl`. Architect reads them and converts each to version 1 of a package: graduates already on a computer when it starts (their endpoint becomes the installation; the old files stay), and folders being imported.

## Versioning, import and export

- Every candidate change to a harness during training produces a new harness version folder; reverted ones are kept for the lineage but are never a parent of a kept one.
- `hash` changes whenever any harness file changes, so a package's harness can be checked against its manifest.
- Export writes `<name>-v<n>/` and `<name>-v<n>.architect.zip`: the version's folder byte for byte, plus a resource's files only when chosen. Import accepts either, checks all of it before anything runs, and installs it as a new local version; the same version twice is found, never installed again. A package joins an agent already here only when that agent has the version it names as parent, by digest; otherwise it becomes an agent of its own.

## Format 1

Format 1 kept the instructions in `system.md` and each skill in one file, `skills/<slug>.md`, with front matter `name` (a title), `summary` and `task_types`. Architect reads it and migrates it in memory: `system.md` becomes `AGENTS.md`, and each skill becomes `skills/<slug>/SKILL.md` with `name: <slug>`, `description: <summary>` and the old title as the first heading of its steps; `task_types` did nothing and is dropped. A helper named like one of today's built-in tools (format 1 allowed `grep` or `run`) becomes `<name>_helper`. A format 1 folder is checked against its hash as stored, then gets a new hash over its files in format 2. It is only ever written in format 2. An older graduate still opens in the workspace and runs on the new tools. From then on the migrated hash identifies the harness, and the old one stays as its provenance (decision 040): a graduate from before the change becomes a version whose package keeps the format 1 hash in `harness.migrated_from`, and a run frozen before the change takes its locked test on the migrated harness when its files still have the frozen hash.
