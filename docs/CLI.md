# The architect command

`architect` lets you list, install, run, check, export and publish your agents from a terminal, without opening the app. It works on the same agents as the app, in the same folder, with the same rules: an agent sees only the folders you gave it, asks before it changes a file unless you allow it, and runs only on a model on your computer. While an agent runs, it can reach nothing but the model on your computer, and the teacher model is never contacted. Only `publish`, `install` from Hugging Face and `train plan --model`, which reads a model's `config.json`, go online, to Hugging Face itself. The exception is `experiment start` and `experiment resume`, which run an experiment on the hosted models it names and spend what its caps allow.

Scripts can use it too: give it a request as a JSON file and it writes the result as JSON, with exit codes that say what happened. Other apps on the same computer can use an agent through `architect serve`, which answers like an OpenAI-compatible chat endpoint.

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

Results go to stdout and everything else (steps, progress, messages) to stderr, so stdout can be read by a script. `list`, `install`, `inspect`, `verify`, `pack`, `export` and `publish` print JSON with `--json`, as do the Lab's `field` and `experiment` commands (below, with the app's own keys), with snake_case keys and a `format` naming what it is. An agent is named by its name as `architect list` shows it (`service-desk`) or by its id (`grd_...`).

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

### serve

```bash
architect serve service-desk [--port 8420] [--version 2] [--token-file token.txt]
```

Serves an agent to other apps on this computer, such as a school's own platform, as an OpenAI-compatible Chat Completions endpoint. It prints where it listens and the token callers must send:

```
$ architect serve service-desk
Serving Service desk, version 2, on muse-glimmer:30b (ollama), to apps on this computer only.
Changes to files come back as proposals; nothing is written. Ctrl+C stops.
Base URL: http://127.0.0.1:8420/v1
Model:    service-desk
Token:    Jx3l...
```

```bash
curl http://127.0.0.1:8420/v1/chat/completions \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"model": "service-desk", "messages": [{"role": "user", "content": "Who owes us money?"}]}'
```

```json
{
  "id": "chatcmpl-5f1c...",
  "object": "chat.completion",
  "created": 1793900000,
  "model": "service-desk",
  "choices": [{ "index": 0, "message": { "role": "assistant", "content": "Ruiz, Ben owes $45.50 on INV-2." }, "finish_reason": "stop" }],
  "architect": {
    "version": 2,
    "harnessHash": "sha256-c077cf82...",
    "certified": false,
    "agreement": null,
    "handedOff": false,
    "steps": [{ "tool": "read", "detail": "data/invoices.csv", "status": "done", "summary": "3 rows", "ms": 2 }],
    "proposedChange": null,
    "refusal": null
  }
}
```

Any OpenAI client works with the base URL, the token as its API key, and the agent's name as the model. `GET /v1/models` lists the agent.

- **This computer only.** It listens on 127.0.0.1 and nowhere else; `--host` is refused (exit 3). Every request needs the bearer token, so another account or program on the computer can't use the agent without it. The token is new each start and printed once; `--token-file` reads one of your own (one word, at least 16 characters) and prints none.
- **The same agent.** Each request runs through the same agent host as `run` and a chat in the app: the active version, its harness, tools, folders and permissions, under the same network guard, so the agent reaches nothing but the model on this computer. Requests are answered one at a time, in order. A request's earlier user and assistant messages are its history; system and developer messages are left out, since the agent's own instructions say how it works, and sampling settings and a client's own tools are ignored.
- **Certified answers.** A version with a certificate (decision 077) makes its attempts at each request and answers with the agreed answer, or hands the request to a person. `architect.certified`, `agreement` (`agreed` of `attempts`, and how many are `required`) and `handedOff` say which.
- **No writes.** The server never changes a file, even when the agent's writes are allowed in the app. A change the agent wants comes back in `architect.proposedChange`, with the rows (`diff`) or lines (`patch`), for a person to make in the app or with `architect run`.
- **Errors** are OpenAI-style (`{"error": {"message", "type", "code"}}`): 401 without the right token, 400 for a malformed request or `"stream": true` (streaming isn't served yet), 404 for another model, 403 when the agent may not run (its model isn't on this computer, say), 409 when `--version` is no longer the active version, 502 when the model or its reply failed.
- **Stopping.** Ctrl+C stops taking requests, stops the replies running (their callers get 503) and exits 130. A port in use exits 1.

| Option | Meaning |
| --- | --- |
| `--port <n>` | The port on 127.0.0.1; 8420 by default, 0 for any free one. |
| `--version <n>` | Serve only while this is the active version: it won't start otherwise, and answers 409 once another is promoted. |
| `--token-file <file>` | The token callers send, instead of a new one. |

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

```bash
architect verify --pack ./service-desk-v2-evidence [--json]
```

Checks an evidence pack (see `pack`) where it is, with the network guard on. It needs no data folder and no agent, so it runs on a reviewer's computer with no network. Every file MANIFEST.json lists must be there with its size and SHA-256, and nothing else may be. `evidence.json` must read, and the package inside must pass its own check and be the version `evidence.json` names. Copied weights must be the base model the version names. It prints each problem in plain words and the SHA-256 of MANIFEST.json, to compare with the one the author read out. Exits 0 when everything matches and 3 otherwise.

### pack

```bash
architect pack service-desk --out ./reviews [--version 2] [--with-weights] [--json]
```

Writes `<name>-v<n>-evidence/` into the folder (decision 098): one folder for a security reviewer and an offline install. It holds:

- `package/`: the version byte for byte. `architect install <pack>/package` installs it on a computer with no network.
- `evidence.json`: the harness and model hashes, the tools with their permissions and the sandbox they run in, the graduates' network guard checked against every host teaching reached, those hosts with their request counts, the changes kept and reverted, the final test per organization (taught on, never seen, real), the locked test's score and the certificate if there is one.
- `README.md`: the same, in a few plain lines.
- `MANIFEST.json`: the SHA-256 and size of every other file.

Nothing from the locked test's tasks or a never-seen organization's files goes in, only scores. The base model is named by its hash; `--with-weights` copies its file from Ollama's store into `weights/` when it is on this computer. The command prints the SHA-256 of MANIFEST.json. The app writes the same pack from a version's panel in Models (Export evidence).

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

### field export

```bash
architect field export "Academy desk" --out ./academy-desk-field [--json]
```

Writes what a field job has taught so far into one new folder, for training a model elsewhere (`docs/SCALE.md`). The job is named by its id or its name.

- `sft/demonstrations.jsonl`: worked examples from train tasks that the job's checker passed, in chat format, each with where it came from, the verdict and what it may be used for. One whose data may not leave this computer is left out.
- `env/`: the train tasks, the files of the organizations the job is taught on, the checker, and `score_client.py` (below).
- `eval/manifest.json`: the final test and the organizations the job has never seen, by hash only. A trained model is qualified on them through Architect's runner.
- `MANIFEST.json`: the job and its version, counts, every file's sha256, permitted uses, and what was left out and why.

Nothing of the final test or of an organization the job has never seen goes in. A file that would carry any stops the export with nothing written, and the command exits 3.

### field list, status and add-org

```bash
architect field list [--json]
architect field status "Academy desk" [--json]
architect field add-org "Academy desk" --folder ./maple --name "Maple Grove" --never-seen [--generated] [--json]
```

A field is named by its id or its name. `list` and `status` read what the Fields place reads: for each field, the organizations it is taught on, those it never sees (generated) and the real ones it never sees, how many versions took the final test, the best version's scores on each of the three kinds, and how many versions hold a certificate. The best version is the one with the highest score on the organizations it was taught on, as in the app. A kind that was not tested shows `-` (null in JSON), never zero. `status` adds each organization by name with its files, and each version's scores and certificate. These are your own results, so they carry the names of your never-seen organizations, as the app does; nothing is sent anywhere.

`add-org` adds one more never-seen organization to a field after it was made (decision 085), through the same call as the app, so it refuses what the app refuses: a folder that is missing or lacks the files the field's organizations have, a name already used, a field of one organization, a field with no final test yet. The folder holds the organization's records and a `tasks.jsonl` (unless the field was drafted). `--never-seen` is required, to say it is kept for the final test and never taught on; `--generated` says its records were generated, and they are taken as real otherwise. It prints the field as `status` does. Qualifying a version on it is done in the app.

### experiment

```bash
architect experiment plan "Academy desk" --arms bare,draft,targeted \
  --hypothesis "Targeted mentoring passes more of the final test than Glimmer alone." \
  --primary targeted-bare:unseen [--seeds 101,102] [--student-usd 15 --spark-usd 10 --wall-minutes 720] [--json]
architect experiment preregister <id>
architect experiment start <id>          # runs until it ends; Ctrl+C pauses it
architect experiment resume <id> [--confirm-study <token>] [--confirm] [--student-cap-usd N] [--drop-arm <arm>]
architect experiment pause|stop <id>
architect experiment status <id> [--json]
architect experiment report <id> [--json]
architect experiment list [--json]
```

These are the app's experiments (decision 074) over the same engine calls, so an experiment made here shows in the app's Experiments place, and one made there can be read or run here. Nothing about what an experiment is changes: planning spends nothing, preregistering freezes the arms, seeds and caps with a hash, and every cap is a hard cap.

- **`plan`** takes a field in the library, or a job folder. `--arms` names the arms (`bare`, `draft`, `targeted`, `reference`, `reference-targeted`, `repeat`, `fixed`, `weights-one-shot`, `weights-targeted`). `--primary a-b:group` is arm a's pass rate less arm b's on `all` of the final test, the organizations the arms are taught on (`seen`) or those they have never seen (`unseen`); `all` is the default. Seeds, rounds and caps start from the app's defaults (final-test seed 101, mentoring seed 1, 4 rounds, $15 for hosted Glimmer, $10 for Spark, no compute, 720 minutes); `--seeds`, `--mentoring-seed`, `--rounds`, `--student-usd`, `--spark-usd`, `--compute-usd` and `--wall-minutes` change them. It prints the id and what the plan would cost at the prices assumed so far.
- **`preregister`** needs the hypothesis and, when two or more arms are compared, a primary comparison; it exits 3 without them, and 3 again once frozen.
- **`start` and `resume`** run the experiment in the command and return when it ends, so they spend: they call the hosted models the experiment names, with keys from `<PROVIDER>_API_KEY` in the environment (for example `OPENROUTER_API_KEY`), and use no GPU on this computer. On a field, Spark studies the organizations first: the run stops with exit 3 and the brief to read (`status` shows it with its token), and `resume <id> --confirm-study <token>` goes on once you have read it. The same exit 3 means the caps cut the plan down (`--confirm` goes ahead with the arms that fit) or an arm can't be paid for at what an attempt cost (`--student-cap-usd` raises Glimmer's cap, `--drop-arm` drops the arm; decision 081). Ctrl+C pauses it with exit 130; the time it ran still counts against its wall clock, and `resume` goes on.
- **`pause`** pauses an experiment running in the same command, so from a terminal the way to pause is Ctrl+C where `start` runs. **`stop`** ends an experiment for good and keeps what it measured.
- **`status`** shows where it stands: the record, each arm's status, what has been spent, whether the final tests were released, and Spark's brief when it waits.
- **`report`** prints the runner's report as Markdown, or as JSON with `--json`, **only once the final tests were released**. Until then it prints nothing on stdout and exits 4. Nothing about the final test or a never-seen organization is in `status` or any other output before the release: the commands print what the experiments API returns, parsed with the shared schemas, which drop anything they don't name.

Only one process should work on an experiment at a time: opening the data folder while the app runs an experiment pauses it, as closing the app would.

### JSON for the Lab commands

`--json` writes one document to stdout with a `format`, validated against the schemas in `packages/shared/src/lab-cli.ts` (and `experiments.ts` for the records), so a script can parse it with the same code: `architect.field-list/1`, `architect.field-status/1`, `architect.experiment-plan/1` (`plan`), `architect.experiment/1` (`preregister`, `pause`, `stop`), `architect.experiment-status/1`, `architect.experiment-list/1` and `architect.experiment-report/1`. `start` and `resume` print `architect.experiment/1` as well, with the record as it ended. Their keys are the app's own records' (camelCase, as in `experiment.json`), not the snake_case of run results. Messages and progress go to stderr; a failure prints once, with what to do, and the exit code says what kind it was.

### reward score

```bash
architect reward score --env ./academy-desk-field/env < attempts.jsonl > scores.jsonl
```

Scores attempts at the field's train tasks with the job's own checker, for a training framework that runs its own rollouts. It reads one JSON request per line on stdin and writes one score per line on stdout, in order, until stdin ends. It makes no network calls and starts no server.

A request: `task_id`, `final_text` (the agent's last reply, with its `ANSWER:` line), `changes` (each changed file's whole new text, as `{ "path": "data/assignments.csv", "text": "..." }`), `tool_calls` (`{ "name", "arguments" }`), `stop_reason` (`answer` by default) and an optional `id` that the score repeats. Each attempt is graded as the runner grades one: a fresh copy of its organization's files with the changes applied through the same checks the agent's write tools use, then the full checker, which also fails a refused or cut-off attempt and a write the task didn't ask for.

A score: `{ "id", "reward": 1 | 0, "reason" }`. A score with `error` (`bad_request`, `unknown_task`, `checker`, `internal`) is not a judgment of the attempt; leave that sample out. `env/score_client.py` (Python, standard library only) starts the command and exchanges lines with it:

```python
from score_client import Scorer
with Scorer() as scorer:
    score = scorer.score(task_id, final_text, changes=[{"path": "data/assignments.csv", "text": csv}])
```

### train (experimental)

```bash
architect train plan --model owner/name [--revision main] [--method lora|qlora|full] [--gpu h100-80gb] [--seq-len 4096] [--micro-batch 1]
architect train bundle --target slurm|kubernetes|skypilot --model owner/name --output ./bundle [--export ./field-export] [plan options]
```

`plan` sizes a training job for a cluster from the model's own `config.json`, read once from the Hub at the revision you name (resolved to its commit), or from a file with `--config`. It prints each memory term with its arithmetic: the resident weights (every expert of a mixture, not only the active ones; LoRA freezes weights, it doesn't remove them), the adapter with its gradients and Adam state, or for a full fine-tune the gradients and optimizer state for every parameter, the activations of one micro-batch (an approximation, stated), FSDP's peak (the largest wrapped unit, such as a whole expert layer, gathered on each GPU), the runtime's own memory, and the headroom kept back. From those it gives the fewest GPUs and nodes that fit. Every number is an estimate and is labeled one. A configuration it can't count (a state-space or encoder-decoder model, or one missing the hidden size, layers, heads or vocabulary) is refused with what is missing; exit code 2. `--gpu` takes h100-80gb, h200, a100-80gb, a100-40gb, l40s or b200, or `--gpu-memory <GB>` for any other. `--json` prints the plan as `architect.training-plan/1`.

`bundle` writes a launch folder for that plan and prints the command that submits it with your own tools: `sbatch submit.sbatch` for Slurm (one `torchrun` per node, meeting at the allocation's first node), `kubectl apply -f pytorchjob.yaml` for Kubernetes (a Kubeflow PyTorchJob that mounts the folder from a claim named `architect-bundle`), `sky launch -c architect-train sky.yaml` for SkyPilot (a task that copies the folder to every node of whatever cloud or Kubernetes cluster your SkyPilot is set up for and runs one `torchrun` per node; it names the GPU the way SkyPilot does, so a GPU given only by `--gpu-memory` is refused). The folder holds the experimental distributed trainer (`train_fsdp.py`: LoRA, QLoRA or full fine-tuning with FSDP, LoRA on attention and every MLP or expert projection), its settings and FSDP config, the pinned packages, the plan, a README with the steps, and `bundle.json`, which records the base model and its commit, the field export's `MANIFEST.json` hash, and the recipe's hash, so trained weights trace back to the field. With `--export`, the export's `sft/*.jsonl` become the bundle's data; nothing else of the export goes in. The revision must be a commit (it is when the config comes from the Hub).

Architect never submits a bundle and never holds cluster credentials. Experimental cluster templates are validated structurally and against simulated schedulers; GPU execution, large-model compatibility and training gains remain unverified. Decision 072 says what is checked.

### certify

```bash
architect certify "Academy desk" --version 2 --job "Academy desk" --k 5 --epsilon 0.10 --delta 0.05 [--calibration-size 60] [--check <org>]... [--student <hosted preset>] [--max-usd 0] [--max-minutes 1440] [--json]
```

Certifies a version that is already frozen, without training it again (decision 079). The calibration tasks come from the taught organizations of the job you name, and none of them is a task, or of a family, that the version's own run (or a run it was improved from) saw or was tested on; a family whose name differs only in case or punctuation, or a request worded the same, counts as seen. If fewer than `--calibration-size` are left, it says how many there are. The tasks are locked in the vault, then the version makes k attempts at each with no Spark, and the certificate is filed on that version for good. `--check` names an organization of the job to test the certified bound at: one it never saw, or one it was taught on, with tasks new to it; one its run was already tested on is refused.

It prints what it will do and cost before anything spends, and stops before an attempt that could take it past `--max-usd` or `--max-minutes`. On this computer it costs nothing; `--student` runs a hosted copy of Glimmer, whose key comes from `<PROVIDER>_API_KEY` (for example `OPENROUTER_API_KEY`). Stopped or paused, the same command again resumes it. The certificate goes to stdout, or the whole record with `--json`.

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
  "architect": { "cli_version": "0.6.1", "request_format": "architect.run-request/1" }
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
| 3 | `not_permitted` | A requirement or permission isn't met: an experiment that waits for you (Spark's brief to confirm, a plan the caps cut down, money for an arm), or that is frozen or in another state than the command needs, a change that needs approval, a folder that isn't bound or granted, an installation that is blocked or needs attention, a model that isn't on this computer, a missing Hugging Face token, scan findings not accepted, a public repository for a private publication. |
| 4 | `task_failed` | The agent ran and didn't do the task: it refused it, stopped without an answer in the steps it had, or ended on a reply it couldn't use. For an experiment: it ended paused, stopped or incomplete, or `report` has no released results. |
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

## A closed network

When the app's Lab has a closed network on (Settings, Privacy; decision 098), the commands that teach (`experiment`, `certify` and the engine work behind `field`) follow it too, and so does every Hub request (`install hf://`, `publish`, `train plan --model`): they read it from the app's `settings.json` at every request, and a teacher, student or Hub outside it is refused with exit 1 (`model_outside_network`) and a message that names the host. Graduates are held to less whatever it says: `run` and `serve` reach only the model on this computer.

## What it doesn't do yet

- An import from the command and one from the app at the same moment, for the same agent, aren't coordinated with each other.
