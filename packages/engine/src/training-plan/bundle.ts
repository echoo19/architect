import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import {
  CLUSTER_TEMPLATE_WORDING,
  FieldExportManifestSchema,
  type FieldExportManifest,
  TRAIN_BUNDLE_FORMAT,
  TrainBundleSchema,
  type ClusterTarget,
  type TrainBundle,
  type TrainingPlan,
} from '@architect/shared';
import { stringify } from 'yaml';
import { loadRecipe } from '../training/recipe';
import { describePlan } from './plan';

/** A bundle that can't be written as asked. */
export class BundleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BundleError';
  }
}

export const BUNDLE_FILE = 'bundle.json';
export const TRAINER_SCRIPT = 'train_fsdp.py';
export const SBATCH_FILE = 'submit.sbatch';
export const PYTORCHJOB_FILE = 'pytorchjob.yaml';
export const SKYPILOT_FILE = 'sky.yaml';
/** The SkyPilot cluster a bundle launches, named so `sky down` can find it again. */
export const SKYPILOT_CLUSTER = 'architect-train';
/** The PersistentVolumeClaim a PyTorchJob mounts the bundle from; the user makes it. */
export const BUNDLE_CLAIM = 'architect-bundle';
const RENDEZVOUS_PORT = 29500;

/**
 * Attention projections (grouped-query and latent attention) and every MLP or expert projection,
 * by module name. The router (`gate`), embeddings and output head are never adapted.
 */
export const LORA_TARGETS =
  '.*\\.(q_proj|k_proj|v_proj|o_proj|q_a_proj|q_b_proj|kv_a_proj_with_mqa|kv_b_proj|gate_proj|up_proj|down_proj|w1|w2|w3)$';

export interface BundleInput {
  target: ClusterTarget;
  plan: TrainingPlan;
  /** The repository's trainer folder: the pinned recipe's pins, and the experimental script. */
  trainerDir: string;
  /** A field export folder (`architect field export`); its sft/*.jsonl become the bundle's data. */
  exportDir: string | null;
  /** An empty or new folder the bundle is written to. */
  outputDir: string;
}

export interface WrittenBundle {
  bundle: TrainBundle;
  dir: string;
  files: string[];
}

const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');

/**
 * Reads a field export and checks it is one: `MANIFEST.json` present and valid, every
 * `sft/*.jsonl` listed in it with the hash it names, and nothing unlisted in `sft/`. Anything
 * else could be an arbitrary folder, so it is refused before a byte is copied.
 */
function readExport(exportDir: string): {
  manifestSha256: string;
  declaredHash: string;
  data: { name: string; bytes: Buffer }[];
} {
  const manifestPath = join(exportDir, 'MANIFEST.json');
  const howTo = 'Point --export at a folder written by `architect field export`.';
  if (!existsSync(manifestPath)) {
    throw new BundleError(`${exportDir} has no MANIFEST.json. ${howTo}`);
  }
  const manifestBytes = readFileSync(manifestPath);
  let manifest: FieldExportManifest;
  try {
    manifest = FieldExportManifestSchema.parse(JSON.parse(manifestBytes.toString('utf8')));
  } catch {
    throw new BundleError(`${manifestPath} isn't a field export manifest. ${howTo}`);
  }
  const sft = join(exportDir, 'sft');
  const names = existsSync(sft)
    ? readdirSync(sft)
        .filter((name) => name.endsWith('.jsonl'))
        .sort()
    : [];
  if (names.length === 0) {
    throw new BundleError(`${exportDir} has no sft/*.jsonl. ${howTo}`);
  }
  const data = names.map((name) => {
    const path = join(sft, name);
    if (!lstatSync(path).isFile()) {
      throw new BundleError(`sft/${name} in ${exportDir} isn't a plain file.`);
    }
    const bytes = readFileSync(path);
    const listed = manifest.files[`sft/${name}`];
    if (listed === undefined) {
      throw new BundleError(
        `sft/${name} isn't listed in ${manifestPath}, so it isn't part of the export.`,
      );
    }
    if (listed !== sha256(bytes)) {
      throw new BundleError(
        `sft/${name} doesn't match the hash in ${manifestPath}; it changed after the export.`,
      );
    }
    return { name, bytes };
  });
  return { manifestSha256: sha256(manifestBytes), declaredHash: manifest.job.sha256, data };
}

function sbatchScript(nodes: number, perNode: number, bundle: TrainBundle): string {
  return `#!/bin/bash
# EXPERIMENTAL, NOT RUN. Written by Architect; never submitted by it.
# ${bundle.base_model.repo} at ${bundle.base_model.revision}, ${bundle.method}, ${nodes} node(s) x ${perNode} GPU(s).
# Field export manifest: ${bundle.field_export?.manifest_sha256 ?? 'none'}. Recipe: ${bundle.recipe.sha256}.
#SBATCH --job-name=architect-train
#SBATCH --nodes=${nodes}
#SBATCH --ntasks-per-node=1
#SBATCH --gpus-per-node=${perNode}
#SBATCH --exclusive
#SBATCH --output=architect-train-%j.out

set -euo pipefail
cd "\${SLURM_SUBMIT_DIR}"

PYTHON="\${PYTHON:-python3}"
HEAD_NODE="$(scontrol show hostnames "\${SLURM_JOB_NODELIST}" | head -n 1)"
RDZV_PORT="\${RDZV_PORT:-${RENDEZVOUS_PORT}}"

# One torchrun per node; they meet at the first node of the allocation.
srun --kill-on-bad-exit=1 "\${PYTHON}" -m torch.distributed.run \\
  --nnodes="\${SLURM_NNODES}" \\
  --nproc_per_node=${perNode} \\
  --rdzv_id="\${SLURM_JOB_ID}" \\
  --rdzv_backend=c10d \\
  --rdzv_endpoint="\${HEAD_NODE}:\${RDZV_PORT}" \\
  ${TRAINER_SCRIPT} --config train.json
`;
}

function pytorchJob(nodes: number, perNode: number, image: string, bundle: TrainBundle): string {
  const launch = [
    'pip install --no-cache-dir -r /bundle/requirements.txt',
    `torchrun --nnodes=${nodes} --nproc_per_node=${perNode} --node_rank="$RANK" --master_addr="$MASTER_ADDR" --master_port="$MASTER_PORT" /bundle/${TRAINER_SCRIPT} --config /bundle/train.json`,
  ].join(' && ');
  const replica = (replicas: number) => ({
    replicas,
    restartPolicy: 'Never',
    template: {
      spec: {
        containers: [
          {
            name: 'pytorch',
            image,
            command: ['bash', '-c', launch],
            workingDir: '/bundle',
            resources: { limits: { 'nvidia.com/gpu': perNode } },
            volumeMounts: [
              { name: 'bundle', mountPath: '/bundle' },
              { name: 'shm', mountPath: '/dev/shm' },
            ],
          },
        ],
        volumes: [
          { name: 'bundle', persistentVolumeClaim: { claimName: BUNDLE_CLAIM } },
          { name: 'shm', emptyDir: { medium: 'Memory' } },
        ],
      },
    },
  });
  const manifest = {
    apiVersion: 'kubeflow.org/v1',
    kind: 'PyTorchJob',
    metadata: {
      name: `architect-train-${bundle.recipe.sha256.slice(0, 8)}`,
      labels: { 'architect.experimental': 'true' },
      annotations: {
        'architect/base-model': `${bundle.base_model.repo}@${bundle.base_model.revision}`,
        'architect/field-export-manifest': bundle.field_export?.manifest_sha256 ?? 'none',
        'architect/recipe': bundle.recipe.sha256,
        'architect/status': 'EXPERIMENTAL, NOT RUN',
      },
    },
    spec: {
      pytorchReplicaSpecs: {
        Master: replica(1),
        ...(nodes > 1 ? { Worker: replica(nodes - 1) } : {}),
      },
    },
  };
  return `# EXPERIMENTAL, NOT RUN. Written by Architect; never applied by it.\n${stringify(manifest)}`;
}

/**
 * SkyPilot's name for a GPU (`sky show-gpus`), from the plan's GPU as the app or the CLI names
 * it: "H100 80GB" or `h100-80gb`. A GPU it can't name is refused rather than guessed.
 */
export function skyAccelerator(gpu: { name: string; memoryGb: number }): string {
  const name = gpu.name.toLowerCase();
  if (/^h100\b|^h100-/.test(name)) return 'H100';
  if (/^h200\b/.test(name)) return 'H200';
  if (/^a100\b|^a100-/.test(name)) return gpu.memoryGb >= 80 ? 'A100-80GB' : 'A100';
  if (/^l40s\b/.test(name)) return 'L40S';
  if (/^b200\b/.test(name)) return 'B200';
  throw new BundleError(
    `SkyPilot launches GPUs by name, and "${gpu.name}" isn't one Architect can name for it. Plan for an H100, H200, A100, L40S or B200.`,
  );
}

/**
 * A SkyPilot task: the bundle folder as its workdir on every node, the pinned image and
 * packages, and one torchrun per node meeting at the first node, as the other targets do.
 */
function skyTask(
  nodes: number,
  perNode: number,
  accelerator: string,
  image: string,
  bundle: TrainBundle,
): string {
  const run = [
    'set -euo pipefail',
    'HEAD_IP="$(echo "${SKYPILOT_NODE_IPS}" | head -n 1)"',
    '# One torchrun per node; they meet at the first node of the cluster.',
    'python3 -m torch.distributed.run \\',
    '  --nnodes="${SKYPILOT_NUM_NODES}" \\',
    '  --nproc_per_node="${SKYPILOT_NUM_GPUS_PER_NODE}" \\',
    '  --node_rank="${SKYPILOT_NODE_RANK}" \\',
    '  --master_addr="${HEAD_IP}" \\',
    `  --master_port=${RENDEZVOUS_PORT} \\`,
    `  ${TRAINER_SCRIPT} --config train.json`,
    '',
  ].join('\n');
  const task = {
    name: SKYPILOT_CLUSTER,
    workdir: '.',
    num_nodes: nodes,
    resources: { accelerators: `${accelerator}:${perNode}`, image_id: `docker:${image}` },
    setup: 'set -euo pipefail\npip install --no-cache-dir -r requirements.txt\n',
    run,
  };
  return [
    '# EXPERIMENTAL, NOT RUN. Written by Architect; never launched by it.',
    `# ${bundle.base_model.repo} at ${bundle.base_model.revision}, ${bundle.method}, ${nodes} node(s) x ${perNode} GPU(s).`,
    `# Field export manifest: ${bundle.field_export?.manifest_sha256 ?? 'none'}. Recipe: ${bundle.recipe.sha256}.`,
    stringify(task),
  ].join('\n');
}

const SUBMIT: Record<ClusterTarget, string> = {
  slurm: `sbatch ${SBATCH_FILE}`,
  kubernetes: `kubectl apply -f ${PYTORCHJOB_FILE}`,
  skypilot: `sky launch -c ${SKYPILOT_CLUSTER} ${SKYPILOT_FILE}`,
};

const TARGET_NAMES: Record<ClusterTarget, string> = {
  slurm: 'Slurm',
  kubernetes: 'Kubernetes',
  skypilot: 'SkyPilot',
};

/** How to submit a bundle on its target, step by step, with its command. */
function submitSteps(bundle: TrainBundle): string[] {
  switch (bundle.target) {
    case 'slurm':
      return [
        '1. Copy this folder to a filesystem every node of your cluster can read.',
        '2. In it, make a Python environment with the pinned packages:',
        '     python3 -m venv .venv && .venv/bin/pip install -r requirements.txt',
        '3. If the base model is gated, export HF_TOKEN in your shell first.',
        '4. Submit it with your own Slurm (add --partition, --account or --time as your cluster asks):',
        `     PYTHON="$PWD/.venv/bin/python" ${bundle.submit}`,
      ];
    case 'kubernetes':
      return [
        `1. Make a PersistentVolumeClaim named ${BUNDLE_CLAIM} in your namespace and copy this folder`,
        '   to its root, so the pods see it at /bundle.',
        '2. Install the Kubeflow training operator if your cluster lacks it (PyTorchJob, kubeflow.org/v1).',
        '3. If the base model is gated, add HF_TOKEN to the container from your own secret.',
        '4. Submit it with your own kubectl:',
        `     ${bundle.submit}`,
      ];
    case 'skypilot':
      return [
        '1. Set up SkyPilot for the clouds or Kubernetes clusters you use; `sky check` lists them.',
        '   SkyPilot copies this folder to every node and installs the pinned packages there.',
        '2. If the base model is gated, add --env HF_TOKEN to pass yours from your shell.',
        '3. From this folder, launch it with your own SkyPilot (add --use-spot or other options as you like):',
        `     ${bundle.submit}`,
        '4. The outputs stay on the first node, in ~/sky_workdir/outputs. Copy them back, then stop',
        '   paying for the GPUs:',
        `     rsync -Pavz ${SKYPILOT_CLUSTER}:~/sky_workdir/outputs/ outputs/`,
        `     sky down ${SKYPILOT_CLUSTER}`,
      ];
  }
}

function readme(bundle: TrainBundle, plan: TrainingPlan, perNode: number): string {
  return [
    'EXPERIMENTAL, NOT RUN',
    '',
    bundle.wording,
    '',
    'Architect wrote this bundle and never submitted it. It holds no credentials.',
    '',
    `Base model: ${bundle.base_model.repo} at ${bundle.base_model.revision}`,
    `Method: ${bundle.method}, on ${bundle.nodes} node(s) x ${perNode} GPU(s) (${TARGET_NAMES[bundle.target]})`,
    `Field export: ${bundle.field_export ? `MANIFEST.json sha256 ${bundle.field_export.manifest_sha256 ?? '(no manifest)'}, ${bundle.field_export.data.length} data file(s) in data/` : 'none; put chat examples in data/*.jsonl before submitting'}`,
    `Recipe: sha256 ${bundle.recipe.sha256} (the trainer files, listed in bundle.json)`,
    `Package pins: from ${bundle.recipe.pins.name}, sha256 ${bundle.recipe.pins.sha256}`,
    '',
    'To submit:',
    ...submitSteps(bundle),
    '',
    'Outputs go to outputs/model, with outputs/result.json beside it. To compare the model with',
    "the field's other candidates, serve it on an OpenAI-compatible endpoint and add it in Architect.",
    '',
    'The plan it was sized from (estimates):',
    ...describePlan(plan).map((line) => (line ? `  ${line}` : '')),
    '',
  ].join('\n');
}

/**
 * Writes a launch bundle for a cluster: the experimental FSDP trainer, its settings and FSDP
 * config, the field export's verified demonstrations, the pinned packages, and an sbatch script,
 * a PyTorchJob manifest or a SkyPilot task, with a README holding the command to submit it.
 * Nothing is submitted and no credential is written.
 */
export function writeTrainBundle(input: BundleInput): WrittenBundle {
  const { plan, target, outputDir } = input;
  const { repo, revision } = plan.model;
  if (repo === null || revision === null || !/^[0-9a-f]{40}$/.test(revision)) {
    throw new BundleError(
      'A bundle needs the model id and its revision as a 40-character commit, so the trained weights trace back to it.',
    );
  }
  if (plan.fit === null) throw new BundleError(`The plan doesn't fit: ${plan.reason ?? ''}`);
  const accelerator = target === 'skypilot' ? skyAccelerator(plan.input.gpu) : '';
  if (existsSync(outputDir) && readdirSync(outputDir).length > 0) {
    throw new BundleError(`${outputDir} isn't empty.`);
  }
  const { nodes, gpusPerNode } = plan.fit;
  const pins = loadRecipe(input.trainerDir);
  const exported = input.exportDir === null ? null : readExport(input.exportDir);

  const lora = plan.input.method === 'full' ? null : pins.recipe.lora;
  const settings = {
    format: 'architect.fsdp-train/1',
    experimental: true,
    base_model: { repo, revision },
    method: plan.input.method,
    precision: plan.input.precision,
    data: 'data/*.jsonl',
    output_dir: 'outputs',
    fsdp_config: 'fsdp_config.json',
    field_export: exported?.manifestSha256 ?? null,
    lora:
      lora === null
        ? null
        : {
            r: plan.input.loraRank,
            alpha: plan.input.loraRank * (lora.alpha / lora.r),
            dropout: lora.dropout,
            target_modules: LORA_TARGETS,
          },
    training: {
      epochs: pins.recipe.training.epochs,
      learning_rate: plan.input.method === 'full' ? 1e-5 : pins.recipe.training.learning_rate,
      lr_scheduler: pins.recipe.training.lr_scheduler,
      warmup_steps: pins.recipe.training.warmup_steps,
      per_device_batch_size: plan.input.microBatch,
      gradient_accumulation_steps: pins.recipe.training.gradient_accumulation_steps,
      max_seq_len: plan.input.seqLen,
      seed: pins.recipe.training.seed,
    },
  };
  const fsdpConfig = {
    backward_prefetch: 'backward_pre',
    forward_prefetch: false,
    limit_all_gathers: true,
    use_orig_params: true,
    sync_module_states: true,
    cpu_ram_efficient_loading: true,
    activation_checkpointing: false,
  };
  const recipeFiles: { name: string; content: string | Buffer }[] = [
    {
      name: TRAINER_SCRIPT,
      content: readFileSync(join(input.trainerDir, 'experimental', TRAINER_SCRIPT)),
    },
    { name: 'chat_spans.py', content: readFileSync(join(input.trainerDir, 'chat_spans.py')) },
    { name: 'train.json', content: `${JSON.stringify(settings, null, 2)}\n` },
    { name: 'fsdp_config.json', content: `${JSON.stringify(fsdpConfig, null, 2)}\n` },
    { name: 'requirements.txt', content: `${pins.recipe.python_packages.join('\n')}\n` },
  ];
  const recipeHashes = recipeFiles
    .map((file) => ({ name: file.name, sha256: sha256(file.content) }))
    .sort((a, b) => (a.name < b.name ? -1 : 1));
  const bundle = TrainBundleSchema.parse({
    format: TRAIN_BUNDLE_FORMAT,
    experimental: true,
    target,
    base_model: { repo, revision },
    method: plan.input.method,
    nodes,
    gpus_per_node: gpusPerNode,
    field_export:
      exported === null
        ? null
        : {
            manifest_sha256: exported.manifestSha256,
            declared_hash: exported.declaredHash,
            data: exported.data.map((file) => ({ name: file.name, sha256: sha256(file.bytes) })),
          },
    recipe: {
      sha256: sha256(recipeHashes.map((file) => `${file.name} ${file.sha256}\n`).join('')),
      files: recipeHashes,
      pins: { name: pins.recipe.name, sha256: pins.sha256 },
    },
    submit: SUBMIT[target],
    wording: CLUSTER_TEMPLATE_WORDING,
  });

  mkdirSync(join(outputDir, 'data'), { recursive: true });
  const written: string[] = [];
  const write = (name: string, content: string | Buffer) => {
    writeFileSync(join(outputDir, name), content);
    written.push(name);
  };
  for (const file of recipeFiles) write(file.name, file.content);
  for (const file of exported?.data ?? []) write(`data/${file.name}`, file.bytes);
  switch (target) {
    case 'slurm':
      write(SBATCH_FILE, sbatchScript(nodes, gpusPerNode, bundle));
      break;
    case 'kubernetes':
      write(PYTORCHJOB_FILE, pytorchJob(nodes, gpusPerNode, pins.recipe.image, bundle));
      break;
    case 'skypilot':
      write(SKYPILOT_FILE, skyTask(nodes, gpusPerNode, accelerator, pins.recipe.image, bundle));
      break;
  }
  write('plan.json', `${JSON.stringify(plan, null, 2)}\n`);
  write(BUNDLE_FILE, `${JSON.stringify(bundle, null, 2)}\n`);
  write('README.txt', readme(bundle, plan, gpusPerNode));
  return { bundle, dir: outputDir, files: written };
}
