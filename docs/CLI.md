# The architect command

`architect` lets you list, install, run, check, export and publish your agents from a terminal, without opening the app. It works on the same agents as the app, in the same folder, with the same rules: an agent sees only the folders you gave it, asks before it changes a file unless you allow it, and runs only on a model on your computer. While an agent runs, it can reach nothing but the model on your computer, and the teacher model is never contacted. Only `publish`, and `install` from Hugging Face, go online, to Hugging Face itself.

Scripts can use it too: give it a request as a JSON file and it writes the result as JSON, with exit codes that say what happened.

## Getting it

**In development**, from the repository after `pnpm install`:

```bash
pnpm architect list
pnpm architect run service-desk
```

Relative paths are read from the folder you typed the command in. `node apps/cli/bin/architect.mjs` does the same without pnpm.

**In the installed app** the command comes with the installer, and runs on the app's own binary as Node (`ELECTRON_RUN_AS_NODE=1`), so there is nothing else to install:

- Windows: `architect.cmd`, beside `Architect.exe` in the folder the app installed to (`%LOCALAPPDATA%\Programs\Architect` by default). Add that folder to `PATH` to type `architect` anywhere, or call it by its full path.
- macOS: `Architect.app/Contents/Resources/architect`. Link it into a folder on `PATH`:

  ```bash
  ln -s /Applications/Architect.app/Contents/Resources/architect /usr/local/bin/architect
  ```

**The data folder** is the app's: `%APPDATA%\Architect` on Windows, `~/Library/Application Support/Architect` on macOS, `$XDG_CONFIG_HOME/Architect` or `~/.config/Architect` on Linux. Set `ARCHITECT_USER_DATA` to use another, as for the app. Only `install` creates anything in a folder that has no agents yet.

## Commands

Results go to stdout and everything else (steps, progress, messages) to stderr, so stdout can be read by a script. `list`, `install`, `inspect`, `verify`, `export` and `publish` print JSON with `--json`, with snake_case keys and a `format` naming what it is. An agent is named by its name as `architect list` shows it (`service-desk`) or by its id (`grd_...`).

### list

```bash
architect list [--json]
```

Every agent on this computer, with the name to run it by, its id, its active version and whether it can run here.

```
NAME          ID        VERSION  STATUS
service-desk  grd_desk  v2       ready
```

### install

```bash
architect install ./service-desk-v2.architect.zip --bind data=./records --grant data=read_write
architect install hf://jake/service-desk --revision 3f1c9e2a... --bind data=./records --grant data=read
```

Installs a package (a `.architect.zip` or a package folder) or a version published to Hugging Face. Everything in the package is checked before any of its code loads, exactly as the app's import checks it, and then its installation checks run on this computer.

| Option | Meaning |
| --- | --- |
| `--revision <commit>` | For `hf://`: the commit to install. A branch or tag is looked up once and its commit recorded. Without it, the commit `main` points at now is looked up once and recorded. |
| `--bind <name>=<folder>` | Binds one of the package's folders, such as `data`, to a folder here. Repeat for each. |
| `--grant <name>=<access>` | Grants `read`, `read_write` or `none` on one of its folders. Never more than the package asks for. |
| `--writes <mode>` | `ask` (default), `allow` or `never`, for changes to files. |
| `--model <name>`, `--model-url <url>`, `--runtime <name>` | The local model to run it on, when not its own base on Ollama at `http://127.0.0.1:11434`. The address must be on this computer. |
| `--no-model-check` | Skips the check that loads the model once. |

A package asks for access; nothing is granted that the command doesn't name. An install that leaves a needed folder unbound or ungranted succeeds, but its checks say what is missing and the command exits 3. A version installed from the Hub keeps its repository and commit, and never changes when the repository does: installing again without `--revision` adds the newer version beside it, as a candidate the app shows.

### run

```bash
architect run service-desk
architect run service-desk --input request.json --output result.json --non-interactive
```

**Without `--input`**, `run` is a conversation: one request per line, each answered in turn in one chat, with history. The answer streams to stdout and the steps to stderr:

```
$ architect run service-desk
Service desk, version 2, on muse-glimmer:30b (ollama).
Changes to files are asked about here. Ctrl+C stops a reply; Ctrl+D ends.
> Who owes us money?
  read data/invoices.csv (3 rows)
Ruiz, Ben owes $45.50 on INV-2, due November 15.
> Add an invoice for Cho Lin, $77.
  read data/customers.csv (3 rows)
Add 1 row to data/invoices.csv:
  + INV-4, C-3, 7700, 2026-12-03, false
Allow this change? [y]es, [n]o, [a]lways for this agent: y
  append data/invoices.csv (1 row added)
Added INV-4 for Cho Lin, $77.00.
```

When the model's reply can't be used (a tool call its runtime can't read, or a reply cut off at its length limit), the turn is asked again, at most twice. A terminal can't take back text it has printed, so the conversation prints `(asked again)` on a line of its own and goes on with the turn's new text; the app's chat takes the old text back instead, and a JSON result's `answer` holds only the final text. A long task never fills the model's context: when a prompt would, the oldest tool results are replaced, in what the model reads, by a note that names the call and says it was cleared (read it again if you need it), and a task whose request, instructions and latest result don't fit at all ends with "This task needs more room than the model's context allows." (decision 057).

On a terminal, a change that needs approval is asked about there; `always` allows this agent's writes from now on, in the app as well. The end of input is a no, and Ctrl+C at the question is a no that stops the run. When stdin isn't a terminal, or with `--non-interactive`, nobody can answer, so such a change ends its reply as `approval_required` and nothing is written. Ctrl+C stops the reply in progress; at the prompt it ends the session. The exit code is the last reply's, or 0 if there was none.

**With `--input`** (`-` reads stdin), `run` does one task from a JSON request and writes a JSON result to `--output`, or to stdout when there is none. The request is checked before anything runs. A write that needs approval it can't ask about ends the run with a structured `approval_required` result: it never waits and never approves by itself. Without `--non-interactive`, and with the request in a file, a terminal can still be asked.

| Option | Meaning |
| --- | --- |
| `--input <file>` | The request (format below); `-` reads it from stdin. |
| `--output <file>` | Where the result goes, written whole or not at all; stdout when absent. |
| `--non-interactive` | Never asks: a change that needs approval fails the run. |
| `--save` | Keeps the conversation in the app, as a chat. Without it nothing is saved. |
| `--timeout <seconds>` | Stops a run that takes longer, as a runtime error. At most 2147483 (about 24 days). |

The agent runs on its active version, with this computer's folders and permissions, exactly as a chat in the app would.

### inspect

```bash
architect inspect service-desk [--json]
architect inspect ./service-desk-v2.architect.zip
```

An agent's versions (state, which is active, evaluation status, where each came from), its model and harness, its folders and permissions here, the author's results ("Evaluated on the author's configuration"), this computer's installation checks ("Installation checks on this computer") and its publications. Given a package file or folder, it checks the package as an install would and says what it holds, without installing it or running any of it.

### verify

```bash
architect verify service-desk [--no-model-check] [--json]
```

Runs the active version's installation checks again: platform and memory, the harness against its hash, its tools loading in the sandbox, its folders and their files, and the model, with one short request. They say whether it runs on this computer. They are not an evaluation, and never show as one; the author's results are under `inspect`. Exits 0 when ready and 3 otherwise.

### export

```bash
architect export service-desk --output ./service-desk-v2.architect.zip [--version 2] [--include resource:data]
```

Writes a version (the active one by default) as one package file, after the same review the app shows: chats, keys, bindings, training traces and private data stay out, and a folder's files go only with `--include resource:<name>`. When the best-effort scan finds something that looks like a key or a private path, nothing is written: the command lists the findings and exits 3, and `--accept-findings <id>` with the id it printed goes ahead once you have checked them.

### publish

```bash
architect publish service-desk --repo jake/service-desk --private
architect publish service-desk --repo jake/service-desk --dry-run
```

Publishes a version to a Hugging Face model repository: private unless `--public`. It first lists every file it will send and what the scan found, then sends the package and a model card, and prints the commit:

```
Published Service desk version 2 to jake/service-desk (private) at commit 3f1c9e2a....
https://huggingface.co/jake/service-desk
Install it with: architect install hf://jake/service-desk --revision 3f1c9e2a...
```

`--dry-run` shows what would go and sends nothing. `--version`, `--include` and `--accept-findings` work as for `export`. Publishing the same version to the same repository again finishes a publication that failed; when one of another version didn't finish, the command says so, and `--version` finishes that one. See "Hugging Face" below.

## Run requests and results

### The request: `architect.run-request/1`

```json
{
  "format": "architect.run-request/1",
  "task": "Who owes us money, and how much?",
  "inputs": ["data/invoices.csv"],
  "version": 2
}
```

| Field | |
| --- | --- |
| `format` | Required, exactly `architect.run-request/1`. |
| `task` | Required: what to do, in the words you would use in the app. Not empty, at most 20,000 characters. |
| `inputs` | Optional: files the task is about, by their path in the agent's folders (`data/<file>` or `output/<path>`). Each must be a file its job names, in a folder that is bound and granted here, and it must exist. They are named to the agent after the task. |
| `version` | Optional: run only if this is the active version. |

Anything else in the request is refused. A request that isn't valid JSON or doesn't match the format ends with exit 2 before the agent is opened.

### The result: `architect.run-result/1`

```json
{
  "format": "architect.run-result/1",
  "status": "succeeded",
  "exit_code": 0,
  "answer": "Ruiz, Ben owes $45.50 on INV-2.",
  "agent": {
    "id": "grd_desk",
    "name": "Service desk",
    "version": 2,
    "digest": "b8d1ec94...",
    "harness_hash": "sha256-c077cf82...",
    "contract_version": 1,
    "evaluation": "ready",
    "model": { "label": "Glimmer", "runtime": "ollama", "name": "muse-glimmer:30b", "base_url": "http://127.0.0.1:11434" }
  },
  "inputs": ["data/invoices.csv"],
  "steps": [{ "tool": "read", "detail": "data/invoices.csv", "status": "done", "summary": "3 rows", "ms": 2 }],
  "artifacts": [],
  "approval": null,
  "refusal": null,
  "error": null,
  "started_at": "2026-11-05T18:00:00.000Z",
  "finished_at": "2026-11-05T18:00:09.412Z",
  "duration_ms": 9412,
  "architect": { "cli_version": "0.5.0", "request_format": "architect.run-request/1" }
}
```

| Field | |
| --- | --- |
| `status`, `exit_code` | The outcome and its exit code (below). |
| `answer` | The agent's answer when it succeeded; null otherwise. |
| `agent` | The version that ran, by its package digest and harness hash, and the local model it ran on. Null when the run never got that far. |
| `steps` | Every tool call, in order, with what it acted on and what it found. |
| `artifacts` | Files the run changed, by logical path. |
| `approval` | For `approval_required`: the change it wanted, with the rows (`diff`) or lines (`patch`) it would have written. Nothing was written. |
| `refusal` | When the agent refused the task as outside its job: the task type and the reason. |
| `error` | What went wrong: a stable `code` for scripts, a `message`, and a `hint` when there is something to do. |
| `chat_id` | With `--save`, the chat the run is saved in. |

A result is written for every run that gets past its command line, invalid requests included, so a script always has JSON to read.

An approval nobody could give looks like this, with exit 3:

```json
{
  "status": "not_permitted",
  "exit_code": 3,
  "answer": null,
  "approval": {
    "tool": "append",
    "file": "data/invoices.csv",
    "summary": "Add 1 row to data/invoices.csv",
    "diff": { "columns": ["invoice_id", "customer_id", "total_cents", "due_date", "paid"], "added": [["INV-4", "C-2", "5000", "2026-12-05", "false"]], "removed": [], "changed": [] }
  },
  "error": { "code": "approval_required", "message": "Add 1 row to data/invoices.csv needs approval, and nobody could give it, so nothing was written.", "hint": "..." }
}
```

## Exit codes

| Code | Outcome | When |
| --- | --- | --- |
| 0 | `succeeded` | It did what was asked. |
| 1 | `runtime_error` | Something failed while running: the model runtime isn't there or failed, the Hub couldn't be reached or an upload broke off, `--timeout` ran out, or a fault. |
| 2 | `invalid_input` | The command line or the request is malformed, or names an agent, file, package, repository or revision that isn't there; a package is damaged or unsafe. |
| 3 | `not_permitted` | A requirement or permission isn't met: a change that needs approval, a folder that isn't bound or granted, an installation that is blocked or needs attention, a model that isn't on this computer, a missing Hugging Face token, scan findings not accepted, a public repository for a private publication. |
| 4 | `task_failed` | The agent ran and didn't do the task: it refused it, stopped without an answer in the steps it had, or ended on a reply it couldn't use. |
| 130 | `cancelled` | Ctrl+C or a stop signal ended it. A second Ctrl+C ends the process at once. |

Every command ends on its own: a run that needs an approval nobody can give fails at once, and a model that stops answering is given up on after the adapter's limits (five minutes of silence), or sooner with `--timeout`.

## Hugging Face

**The token** comes from the standard places, nearest first: `HF_TOKEN` (or the older `HUGGING_FACE_HUB_TOKEN`), then the token file that `hf auth login` writes (`HF_TOKEN_PATH`, else `token` in `HF_HOME`, which defaults to `~/.cache/huggingface`). The app also uses a key saved in its Settings, first, and Settings says where the token comes from without showing it. The token goes only to the Hub's own API, never to its upload or download hosts, and never into a package, model card, record or message; the command says only where it found it. `HF_ENDPOINT` points the command, and the app, at another Hub address; a key saved in the app still goes only to huggingface.co.

**Publishing** sends the version's package exactly as `export` would write it, after the same review and scan, which covers the model card too. A new repository is made private unless `--public`. An existing repository keeps its visibility: a private one stays private even with `--public`, and a public one is refused for a private publication rather than made to hold it. The package goes up in one commit, large files (an adapter) through LFS, and is checked against the Hub's own listing; then a second commit adds the model card, made only from the package's manifest, with the exact command to install that commit. The publication is recorded on this computer with the repository and the package's commit, and only once all of that is done is it complete. A failure leaves it failed, never a release; publishing again finishes the same record, without sending what the Hub already has. Files an earlier version left in the package's folders (`harness/`, `evidence/`, `adapter/`, `resources/`) are removed; nothing else in the repository is touched, and the earlier version keeps its own commit.

**The scan is a best effort.** It looks for key shapes, the Hugging Face token the command would use, and paths that name this computer's user or the app's data. The command can't see keys saved in the desktop app (the system encrypts them for the app alone); the app's own publishing checks for those too. Trained weights may keep traces of the data they learned from, whatever the scan finds.

**Installing** from `hf://owner/name` downloads `graduate.json` and only the files it lists, at one commit, checking each against its sha256 and size as it arrives, then installs the folder exactly as a local package. The repository's other files (the model card, `.gitattributes`) are never fetched. A public repository needs no token; a private one does. Installing a version again from the Hub that came from a file before records the commit with it.

**The Hub copy doesn't run anywhere by itself.** Uploading doesn't make the agent runnable through hosted inference; it runs with Architect on the computer that installs it.

## Local models

The command reads the app's own settings file for local models, as the app does: quiet mode's thread cap for a local student and for llama-server, the llama-server chosen in Settings (else the one on `PATH`), and the default student's Ollama when it is on this computer. A version with an adapter runs on llama.cpp (decision 041), with a llama-server of the command's own (`local-runtime/cli` in the data folder) that stops when the command ends.

The command takes the GPU in turns with the open app (decision 046). A run holds it from the start of its reply to the end, except while it waits for an approval: the app's idle llama-server stops first, and a check or a training step waits for the reply. When the app is answering a chat, or checking an agent, the run waits its turn for up to 5 minutes, then exits 1 with an error that says what holds the GPU.

## What it doesn't do yet

- An import from the command and one from the app at the same moment, for the same agent, aren't coordinated with each other.
