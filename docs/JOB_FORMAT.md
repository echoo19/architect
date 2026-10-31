# The job folder

A job folder is what "Import a job file" reads, what an experiment runs on as its field's folder, and what Architect Lab writes when it drafts a field from several organizations' folders (decision 083). It holds a job file, its tasks, the files the agent works from and, if the tasks need one, a checker.

```
job.json                     the job: what the agent does, its files, its settings
tasks.jsonl                  example requests with their expected answers, one per line
data/                        the files the agent works from (a job of one organization)
orgs/<id>/data/              or each organization's own copy of those files
checker.js                   only for tasks that are checked by what the agent changed
```

The sample jobs are complete examples: `examples/home-services/job` (one organization, a checker) and `examples/academy/job` (Academy desk: four academies, one never seen).

The sample jobs are complete examples: `examples/home-services/job` (one organization, a checker), `examples/academy/job` (Academy desk: four academies, one never seen) and `examples/assay-desk/job` (Assay desk: four screening labs, one never seen, with export files only some labs have).

## job.json

Every field is checked against `JobSchema` in `packages/shared/src/job.ts` when the folder is imported. A file that fails says which field is wrong.

| Field | What it holds |
| --- | --- |
| `format` | Always `1`. |
| `id` | A short id, such as `shop-desk`. Architect picks another if it is taken. |
| `name` | The agent's name, up to 60 characters. |
| `description` | What the agent does, in a few sentences. The teacher reads it. |
| `summary`, `does`, `doesNot` | Optional: one line, and short lists of what it does and never does. |
| `createdAt` | An ISO date and time. |
| `businessDate` | Optional `YYYY-MM-DD`: the day the records are current as of, which the agent treats as today. |
| `taskTypes` | Each kind of request: `id` (lowercase letters, digits, `_`), `label`, optional `description`. Every task's `type` must be one of these. |
| `data.files` | Each file the agent may open: `name`, `kind` (`table` for CSV, `text` for anything read as text), `access` (`read` or `write`), optional `description`, and `optional: true` for a file some organizations lack. |
| `data.output` | Optional: lets the agent create files in an `output/` folder. |
| `permissions` | `writes` and `unseenFiles`, each `ask`, `allow` or `never`. |
| `checker` | `{ "kind": "builtin" }` when every task expects an answer or facts; `{ "kind": "module", "path": "checker.js" }` when some expect an end state. |
| `requirements` | `passRate` (0 to 1) the agent must reach on the final test; optional `p95LatencyMs`. |
| `budget` | Hard caps: `maxRounds`, `maxMentorUsd`, `maxWallMinutes`. |
| `mentor`, `student` | The teacher and the agent's model. Copy them from a sample job; importing in the app replaces them with the ones you chose in Settings. |
| `startingHarness` | `{ "kind": "blank" }`, or `{ "kind": "import", "path": "harness" }` for a harness folder beside the job file. |
| `splits` | `seed`, and how many tasks go to `calibration`, `train` (practice), `dev` (check tasks) and `test` (the final test). They must add up to the tasks of the organizations it is taught on. |
| `evaluation` | `trainBatch`, `minDevGain`, `maxTypeRegression`, optional `devRepeats` and `patience`, optional `certify` (decision 077). |
| `organizations` | Optional. Leave it out for one organization. Otherwise each organization the job serves: `id` (lowercase letters, digits, `-` and `_`; it is a folder name), `name`, `synthetic` (`true` for generated records, `false` for real ones), and `role`: `train` (taught on) or `transfer` (never seen). At least one must be `train`. |
| `organizationNoun` | Optional. The word the app uses for one organization, lowercase and singular, such as `academy` or `clinic`: "Another academy…", "Not tested at this academy". Absent: `organization`. |

## tasks.jsonl

One task per line, as JSON, checked against `TaskSchema` in `packages/shared/src/task.ts`.

| Field | What it holds |
| --- | --- |
| `id` | Unique across the whole file. |
| `type` | One of the job's task types. |
| `family` | Tasks that are near copies of each other share a family, so they always land in the same set. A family stays inside one organization. |
| `org` | The organization's id. Required on every task when the job lists organizations; leave it out otherwise. |
| `prompt` | The request as the agent reads it. The agent ends its reply with a line `ANSWER: <json>`. |
| `expected` | What counts as right (below). |
| `meta` | Optional notes for people reading the results. The agent never sees them. |

`expected` takes one of three shapes:

- `{ "kind": "answer", "value": ..., "compare": { "mode": "exact" } }`: the ANSWER must equal the value. `mode` can be `exact` (text compared without case or outer spaces), `set` (a list in any order) or `number` (with an optional `tolerance`).
- `{ "kind": "facts", "facts": [{ "path": "email", "value": "ada@example.com" }] }`: each dotted path into the ANSWER object must hold its value; anything else in the answer is ignored.
- `{ "kind": "end_state", "validator": "row_added", "params": { ... }, "writes": ["notes.csv"] }`: the checker's validator decides from the files after the attempt. `writes`, when given, lists the only files the attempt may change.

How tasks are used: the tasks of the organizations the job is taught on are split into calibration, practice, check and final-test sets by `splits`. The final test is sealed in the vault the moment the job is imported, and so is every task and file of an organization it never sees. The teacher never reads either.

## The files

For a job of one organization, every file in `data.files` sits in `data/` beside `job.json`. For a job with organizations, each organization has its own copy at `orgs/<id>/data/`, under the same names; there is no `data/`. A task's files are its organization's. An organization that is never seen needs the same files as the others, and is copied into the vault, not the job.

## checker.js

Only tasks that expect an end state need a checker. It is plain JavaScript run in a sandbox with no clock, no randomness, no network and no file access beyond what it is given, so the same attempt always gets the same verdict. The teacher can't read or change it.

It defines one variable, `validators`, an object of functions. The runner calls the one a task names with the task's `params` and a context:

- `ctx.readTable(name)`: the table after the attempt, one object per row, each value a string, empty cells `null`.
- `ctx.readOriginalTable(name)`: the same table before the attempt.
- `ctx.answer`: the parsed ANSWER, or `null`. `ctx.finalText`: the reply's text. `ctx.toolCalls`: each call the agent made, with its name and arguments.

A validator returns `{ pass, reason, details }`: `pass` is true or false, `reason` is one sentence a person can read, and `details` is an optional object.

## A worked example

A shop desk for three shops: it is taught on two and tested on a third it never sees. The folder:

```
shop-desk/
  job.json
  tasks.jsonl
  checker.js
  orgs/acme/data/customers.csv
  orgs/birch/data/customers.csv
  orgs/cedar/data/customers.csv
```

`job.json`, with the `mentor` and `student` blocks copied from a sample job and left out here:

```json
{
  "format": 1,
  "id": "shop-desk",
  "name": "Shop desk",
  "description": "Answers staff questions about a shop's customers and keeps its follow-up notes.",
  "createdAt": "2026-10-30T00:00:00.000Z",
  "taskTypes": [
    { "id": "email", "label": "Customer emails" },
    { "id": "note", "label": "Follow-up notes" }
  ],
  "data": {
    "files": [{ "name": "customers.csv", "kind": "table", "access": "write" }]
  },
  "permissions": { "writes": "ask", "unseenFiles": "never" },
  "checker": { "kind": "module", "path": "checker.js" },
  "requirements": { "passRate": 0.9 },
  "budget": { "maxRounds": 8, "maxMentorUsd": 5, "maxWallMinutes": 240 },
  "startingHarness": { "kind": "blank" },
  "splits": { "seed": 7, "calibration": 4, "train": 16, "dev": 10, "test": 14 },
  "evaluation": { "trainBatch": 12, "minDevGain": 2, "maxTypeRegression": 1 },
  "organizations": [
    { "id": "acme", "name": "Acme Outfitters", "synthetic": false, "role": "train" },
    { "id": "birch", "name": "Birch Supply", "synthetic": false, "role": "train" },
    { "id": "cedar", "name": "Cedar Goods", "synthetic": false, "role": "transfer" }
  ]
}
```

Two lines of `tasks.jsonl` (the 44 tasks of Acme and Birch fill the four sets; Cedar's tasks are its own and all sealed):

```json
{"id":"acme-email-1","type":"email","family":"acme:C-1001","org":"acme","prompt":"What is the email of customer C-1001?","expected":{"kind":"facts","facts":[{"path":"email","value":"ada.park@example.com"}]}}
{"id":"cedar-note-1","type":"note","family":"cedar:C-2040","org":"cedar","prompt":"Note that customer C-2040 asked for a callback.","expected":{"kind":"end_state","validator":"note_set","params":{"customer":"C-2040","note":"callback"},"writes":["customers.csv"]}}
```

`checker.js`:

```js
var validators = {};

// note_set: the customer's note now mentions the word asked for, and no other row changed.
validators.note_set = (params, ctx) => {
  const before = ctx.readOriginalTable('customers.csv');
  const after = ctx.readTable('customers.csv');
  const row = after.find((r) => r.customer_id === params.customer);
  if (!row) return { pass: false, reason: `Customer ${params.customer} is missing.` };
  if (!String(row.note || '').toLowerCase().includes(params.note)) {
    return { pass: false, reason: `The note for ${params.customer} doesn't mention ${params.note}.` };
  }
  const changed = after.filter((r, i) => JSON.stringify(r) !== JSON.stringify(before[i]));
  if (changed.length !== 1) return { pass: false, reason: `${changed.length} rows changed, not one.` };
  return { pass: true, reason: `The note for ${params.customer} mentions ${params.note}.` };
};
```

Import `job.json` from the app. Cedar's files and tasks go to the vault; the job you see lists Acme and Birch.

## Without writing it by hand

In Architect Lab, Describe offers "Several organizations" and Fields has New field: describe the job once, add each organization's folder, name it, and mark it Taught on or Never seen. The teacher drafts the kinds of task from the taught organizations' files, Architect makes each organization's tasks from its own files, and the folder above is written and imported for you. It makes lookups, lists and totals (decision 058); a job that needs a checker for end states, or a policy rule, is still written by hand.
