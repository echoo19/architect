# What three requests ask of Architect

Y Combinator's Requests for Startups for Winter 2027 came out after Architect was started (`SPEC.md` is dated Oct 26, 2026; the first commit is Oct 27). Three of them describe what it does. The owner, Nov 1: they are not only credibility; read them for what to build next. This page reads each request line by line against the product: what already answers it, and what it asks for that Architect doesn't do yet. Quotes are one sentence each, from https://www.ycombinator.com/rfs.

## Own Your Intelligence (Jon Xu)

> "Someone has to turn workflows into evals, expertise into training data, production failures into improvements, and carry all of it forward with each new base model."

| The ask | Today | Next |
| --- | --- | --- |
| workflows into evals | Study and Define turn an organization's material into tasks and a deterministic checker; sealed organizations it never saw | |
| expertise into training data | Field export: checker-verified demonstrations, the outcome scorer (071) | |
| production failures into improvements | Teach this (048, 066), counterexamples that become regression tests (078), lineage | |
| carry it forward with each new base model | **Carry a field to a new model** (095): "Move to another model" makes the field's next version on any connected model from everything it has (harness, lessons, counterexamples, tasks, checker), sealed as it was; a short training takes the same final test and never-seen organizations, and its report shows each organization and skill before and after. The agent switches only when the person makes the new version the one in use, which shows what the new model gains and loses and can be undone | |

## AI for the Air-Gapped Economy (Brad Flora)

> "The most valuable data in the world isn't in the cloud."

The request names on-prem models, deployment tooling and security accreditation.

| The ask | Today | Next |
| --- | --- | --- |
| runs inside the walls | Graduates make no network calls except to the local runtime (invariant 3, tested) | |
| teaching inside the walls too | Any OpenAI-compatible teacher and student, including self-hosted Spark Open and cluster endpoints | **A closed network**: a Lab setting that names the hosts teaching may reach; every adapter refuses any other, and each run records every host it contacted. |
| deployment tooling, accreditation | Installation checks (`architect verify`), packages | **An evidence pack**: one folder for a reviewer and an offline install: the version, its harness and model hashes, tool permissions, the network test, the hosts teaching contacted, lineage, results per organization and the certificate, all hashed, with `architect verify --pack` checking it on a machine with no network. |

## Vertical Foundation Models (Diana Hu)

> "The hard part is getting high-quality, vertical-specific, verifiable rewards."

The request also asks for "a typed decision and a probability instead of generated text", and for matching general-purpose models "at orders of magnitude less inference compute".

| The ask | Today | Next |
| --- | --- | --- |
| verifiable rewards | The outcome scorer from every field's checker; sealed evaluations (071, 072) | |
| a typed decision and a probability | Certified answers: agreement across k attempts, a calibrated threshold, abstention (077) | **Served answers carry it**: `architect serve` returns the structured answer with its agreement and whether it is within the certificate, or a hand-off. |
| match general models at far less compute | Measured against the bare student only | **The teacher alone as an arm**: the large model does the job itself, as an agent under test in a run of its own, on the same final test; the report and the paper show accuracy against cost per 1,000 requests and where each runs. |

## Order

1. ~~Carry a field to a new model (it also makes "any model" concrete).~~ Decision 095.
2. The teacher alone as an arm, and served answers that carry their certificate.
3. A closed network and the evidence pack.

Each stays small: built from records and runs that already exist, no new orchestration.
