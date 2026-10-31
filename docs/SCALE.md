# From a specialist to a field model: the plan

Adopted on Oct 30 at the owner's word: Architect is a scientific tool for building industry-specific models, by changing a model's harness and by fine-tuning it, at any scale up to a startup's own GPU cluster. A legal or tutoring company should be able to take what Architect learns about a field and train a large open model on it. This page is the plan and the contract for that part. `docs/FIELD.md` covers fields and organizations; this page covers what a field produces and where it can be trained.

## The claim, and what we can show

Every field Architect teaches produces three assets:

1. **Verified demonstrations**: worked examples on train tasks whose outcome the deterministic checker confirmed, with where each came from and what it may be used for. They are supervised fine-tuning data.
2. **A reward**: the field's train tasks and its deterministic checker, packaged as an outcome scorer a training framework can call. Fields with checkable outcomes are where reinforcement learning with verifiable rewards works.
3. **Sealed evaluations**: organizations the model never trained on, kept in the vault and opened once for a frozen candidate.

Those assets can train a model at three scales: the harness only (what Architect measures today), a LoRA adapter on one rented GPU (built, tested against stand-ins, decision 035), and a large open model on a cluster of GPUs (this plan).

What we can show by Nov 4, stated plainly in the product and the submission: Architect exports a field's checker-verified data and an outcome scorer, sizes a training job from the chosen model's own configuration, and writes experimental cluster templates checked structurally and against simulated schedulers. No cluster job has run, and no large model has been trained. No cloud credit is spent on it.

## Amendments after a second reading (Oct 30, GPT-6 Astra)

- *Wording.* In the product and the submission: "Architect develops and evaluates field-specific agent harnesses and exports checker-verified training examples. Experimental cluster templates are validated structurally and against simulated schedulers; GPU execution, large-model compatibility and training gains remain unverified." Producing industry-specific models is the direction; the measured result is a harness.
- *Train material only.* Demonstrations come from the train split alone, as the dataset builder already guards; dev stays for selection.
- *The reward is an outcome scorer for external rollout systems,* not an environment or a trainer: a local JSONL process (one request per line in, one score per line out) with a thin Python subprocess client. It calls the job's full checker (`createChecker`: completion and allowed writes too, not only the validator), rebuilds the original and final state from a fresh organization snapshot plus the attempt's validated changes, keeps the sandbox limits, and returns `reward` 1 or 0, the reason, and an infrastructure-error status apart. Parity is shown on passing, failing and forbidden-write fixtures. No HTTP server.
- *No live submit.* A target writes its bundle and shows the exact command to run with your own scheduler (`sbatch …`, `kubectl apply -f …`). Architect never holds cluster credentials.
- *Sizing.* Every expert's weights are resident, not only the active ones; LoRA freezes weights, it doesn't remove them. The plan adds FSDP's peak (the largest wrapped unit gathered on each rank), activations and the adapter's own optimizer state, and shows each term.
- *The distributed recipe is a separate, experimental file* (a causal-LM trainer with FSDP and LoRA targets for attention and expert layers), apart from the pinned Glimmer recipe and its GGUF conversion, which stay as they are.
- *Reimporting* a model trained elsewhere is by an OpenAI-compatible endpoint the user serves, qualified like any candidate; nothing more is built for it now.

## Contract

1. **Field export** (`architect field export`, and a button on the job). One folder, versioned and hashed:
   - `sft/`: verified demonstrations in chat format (JSONL), from train material only, each with its source, the checker's verdict and its permitted uses. Nothing from a sealed organization or the locked test.
   - `env/`: the outcome scorer. The train tasks, the train organizations' file snapshots, the checker, and `architect reward score` (JSONL in and out, see the amendments) with a short Python client beside it, since training frameworks are Python.
   - `eval/`: a manifest naming the sealed organizations by hash only. Qualification of a trained model goes back through Architect's runner, which opens them once.
   - `MANIFEST.json`: field and job versions, counts, hashes, permitted uses, and what was left out and why.
2. **Training plan** (`architect train plan`). Given a model on Hugging Face (any id; its `config.json` is read in setup, never by a graduate), a method (LoRA, QLoRA, full fine-tune, or reinforcement learning against the reward) and a target, it works out the memory the weights, gradients, optimizer state and activations need, and from that the GPUs and nodes, with the arithmetic shown. Mixture-of-experts models are sized from their expert counts. Estimates are labeled estimates.
3. **Targets.** Each writes a launch bundle and shows the command that submits it with the user's own tools:
   - *This computer*: the existing local path (no GPU use in development).
   - *Hugging Face Jobs*: the existing backend (decision 035).
   - *Slurm*: an `sbatch` script running `torchrun` across nodes with FSDP.
   - *Kubernetes*: a PyTorchJob manifest (Kubeflow training operator).
   The trainer recipe gains a distributed launch (FSDP, or DeepSpeed ZeRO-3) and LoRA targets for mixture-of-experts layers. A bundle carries the field export's hash, the base model's revision and the recipe, so the trained weights trace back to the field.
4. **Coming back** (built, decision 086). A model trained elsewhere returns as an OpenAI-compatible server the user runs on this computer. The student settings take it as "Server on this computer": an address on this computer (`127.0.0.1`, `localhost` or `[::1]`, with a port; any other is refused with the reason) and a model name. On Compute, "Qualify a trained model" picks a field, one of its tested harness versions (the best is marked) and that server, then runs the version's locked test and its never-seen organizations through the re-test path with that model, with no mentor and no money. The card is filed with the model's name and "Trained elsewhere"; the run it borrowed the harness from is never changed. It uses this computer's GPU, and the card says so before it starts. A model that can't run on this computer is never sold as an offline graduate. Tested against a fake local server, never a real model.

## Where it shows

- **The app:** in two places of the Lab. Fields → a field → Assets holds the field's assets with their counts and the export button. Compute holds the rest: where training runs, the training plan (model id, method, target, GPUs, nodes, memory terms and the estimate), the bundle and its command, and Qualify a trained model. Untested paths say so, in the amendments' words.
- **The CLI:** `architect field export`, `architect reward score`, `architect train plan`, `architect train bundle --target slurm|kubernetes`.
- **The submission:** README, the results paper's direction section and the film describe the path from a specialist to a field model, and say plainly which parts are measured (harness), built and tested on stand-ins (single-GPU adapter, cluster launch), and future (a trained field model).

## Rules

- Invariant 1 holds: nothing from a never-seen organization or the final test enters an export, a dataset, the reward environment or a bundle. Tests check each.
- Data permissions carry through: a demonstration whose source may not be used for training is left out, and the manifest says so.
- No cloud credit and no GPU in development or tests. Schedulers, SSH and kubectl are stand-ins in tests.
- Keep it small: generated files and a sizing function, not an orchestration platform.

## Lanes

| Lane | Branch | Owns |
| --- | --- | --- |
| Field export and reward | `scale/export` | `sft/`, `env/` with the outcome scorer and Python client, `eval/` manifest, the CLI commands |
| Training plan and targets | `scale/targets` | sizing from `config.json`, Slurm and Kubernetes bundles, the experimental distributed recipe |
| Scale page | `scale/ui` | the page, after the two lanes' APIs exist |
| Positioning | later | README, results paper, site |
