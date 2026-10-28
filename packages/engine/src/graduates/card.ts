import {
  METHOD_LABELS,
  slugify,
  type Method,
  type PackageManifest,
  type PackageResource,
} from '@architect/shared';

/** Says plainly what a Hub copy is and isn't, on the card and wherever a publication is shown. */
export const HOSTED_INFERENCE_NOTE =
  "Uploading this repository to the Hub doesn't make the agent runnable through hosted inference services. It runs with Architect on your own computer, with a local copy of its base model.";

/** What the card says in place of the commit while the package hasn't been uploaded yet. */
export const PENDING_REVISION = '<the commit this upload makes>';

export interface CardOptions {
  /** `owner/name`. */
  repository: string;
  /** The commit that holds the package, or null while it doesn't exist yet. */
  revision: string | null;
}

/** Text that sits in a table cell without breaking it. */
const cell = (text: string): string => text.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|');

const percent = (share: number): string => `${Math.round(share * 1000) / 10}%`;

function yamlString(text: string): string {
  return JSON.stringify(text);
}

function access(resource: PackageResource): string {
  return resource.access === 'read_write' ? 'read and change' : 'read';
}

function frontMatter(manifest: PackageManifest): string[] {
  const tags = ['architect', 'agent'];
  if (manifest.model.adapter) tags.push('lora', 'gguf');
  return [
    '---',
    ...(manifest.terms.license ? [`license: ${yamlString(manifest.terms.license)}`] : []),
    'tags:',
    ...tags.map((tag) => `- ${tag}`),
    '---',
    '',
  ];
}

function modelSection(manifest: PackageManifest): string[] {
  const { base, adapter, inference, runtime, label } = manifest.model;
  const pinned = [
    base.digest ? `weights digest \`${base.digest}\`` : null,
    base.revision ? `revision \`${base.revision}\`` : null,
  ].filter((part): part is string => part !== null);
  const lines = [
    '## Model',
    '',
    `- Base model: \`${base.name}\` (${label})${pinned.length > 0 ? `, pinned to ${pinned.join(' and ')}` : ''}${base.quantization ? `, ${base.quantization}` : ''}. Its weights are not in this repository: Architect uses that exact build from the local model store, or tells you what to download.`,
  ];
  if (adapter) {
    lines.push(
      `- Adapter: \`${adapter.path}\`, a LoRA adapter in GGUF format (sha256 \`${adapter.sha256}\`, ${adapter.sizeBytes} bytes), made for the base build \`${adapter.baseDigest}\` and applied at scale ${adapter.scale}. It loads on that build only.`,
    );
    if (adapter.standIn) {
      lines.push(
        '- This adapter came from the stand-in training backend: it was built for testing and never trained.',
      );
    }
  } else {
    lines.push(
      '- Adapter: none. The base weights are unchanged; everything learned is in the harness.',
    );
  }
  lines.push(
    `- Runtime: ${runtime.compatible.join(' or ')} on this computer, with a context of ${inference.contextLength} tokens.`,
    '',
  );
  return lines;
}

function harnessSection(manifest: PackageManifest): string[] {
  const { harness } = manifest;
  return [
    '## Harness',
    '',
    `The harness in \`harness/\` is the agent's instructions, skills, tools and settings: harness format ${harness.format}, hash \`${harness.hash}\`. Its tools run in Architect's sandbox, which has no network and touches only the folders you grant. It needs an Architect build that reads harness format ${harness.format}.`,
    '',
  ];
}

const METHOD_WORDS: Readonly<Record<Method, string>> = {
  architect:
    'a mentor model watched the student attempt practice tasks and changed its harness one diagnosed failure at a time, keeping a change only when it helped on separate development tasks',
  one_shot:
    "a mentor model wrote the harness once from the job's description and examples, without watching any attempts",
  self_reflection: 'the student revised its own harness after its practice attempts',
  bare: "the student's starting harness, with no changes from a mentor",
};

function methodSection(manifest: PackageManifest): string[] {
  const { evidence, model } = manifest;
  const method = manifest.identity.method;
  const lines = ['## How it was made', ''];
  lines.push(`- Method: ${METHOD_LABELS[method]}: ${METHOD_WORDS[method]}.`);
  if (evidence.provenance) {
    const { mentor, student } = evidence.provenance;
    lines.push(
      `- Mentor: ${mentor.label} (\`${mentor.model}\`). Student: ${student.label} (\`${student.model}\` on ${student.runtime}).`,
    );
  }
  lines.push(`- ${evidence.counts.rounds} rounds, ${evidence.counts.keptChanges} changes kept.`);
  if (model.adapter && !model.adapter.standIn) {
    lines.push(
      `- Weights: a LoRA adapter trained on verified lessons${model.adapter.trainingJobId ? ` (training job \`${model.adapter.trainingJobId}\`)` : ''}.`,
    );
  }
  lines.push('');
  return lines;
}

function evaluationSection(manifest: PackageManifest): string[] {
  const { evidence, contract, requirements } = manifest;
  const lines = [`## Evaluation`, '', `${evidence.label}. Status: **${evidence.status}**.`, ''];
  const summary = evidence.summary;
  if (!summary) {
    lines.push('No locked test measured this version, so there are no results to report.', '');
  } else {
    lines.push(
      `- Locked test: ${summary.score.pass} of ${summary.score.total} held-out tasks passed (${percent(summary.passRate.actual)}; the job asks for ${percent(summary.passRate.target)}${summary.passRate.met ? ', met' : ', not met'}).`,
    );
    if (summary.p95LatencyMs) {
      lines.push(
        `- Slowest 5% of replies: ${Math.round(summary.p95LatencyMs.actual)} ms (the job allows ${summary.p95LatencyMs.target} ms).`,
      );
    }
    lines.push(
      `- The tasks were held out from training: ${evidence.counts.testTasks} tasks of the job's own task types, written for the job's data. They are not a general benchmark.`,
      `- Measured against version ${evidence.contractVersion} of the job's contract.`,
      '',
      '| Task type | Passed | Tasks |',
      '| --- | --- | --- |',
      ...summary.perType.map(
        (type) =>
          `| ${cell(type.label)}${type.refused ? ' (refused by design)' : ''} | ${type.pass} | ${type.total} |`,
      ),
      '',
    );
  }
  if (evidence.provenance) {
    lines.push(
      `Tested on the ${evidence.provenance.testedOn === 'local' ? 'local' : 'hosted'} student${evidence.provenance.ranOffline ? ', offline' : ''}.`,
    );
  }
  for (const tested of requirements.tested) {
    lines.push(
      `- Tested device: ${tested.os} ${tested.arch}, ${tested.backend}${tested.memoryBytes ? `, ${Math.round(tested.memoryBytes / 1024 ** 3)} GB of memory` : ''}.`,
    );
  }
  if (requirements.measured.latencyMs) {
    lines.push(
      `- Measured reply time: ${Math.round(requirements.measured.latencyMs.p50)} ms typical, ${Math.round(requirements.measured.latencyMs.p95)} ms for the slowest 5%.`,
    );
  }
  lines.push(
    '',
    `Pass bar of the contract: ${percent(contract.acceptance.passRate)} of the locked test.`,
    '',
  );
  return lines;
}

function limitationsSection(manifest: PackageManifest): string[] {
  return [
    '## Limitations',
    '',
    ...manifest.requirements.limitations.map((limitation) => `- ${limitation}`),
    "- These results describe the author's tasks and data on the author's configuration. Installation checks on another computer show that it runs there; they don't measure it again.",
    `- It does only what its job covers: ${manifest.contract.capabilities.doesNot.length > 0 ? manifest.contract.capabilities.doesNot.join('; ') : 'nothing outside the task types above'}.`,
    '',
  ];
}

function dataSection(manifest: PackageManifest): string[] {
  const lines = [
    '## Data access',
    '',
    'Each installation binds these folders to its own and grants access itself. The package asks; it never grants. The agent reaches no network: only the model runtime on the same computer.',
    '',
    '| Folder | Needed | Asks to | Files |',
    '| --- | --- | --- | --- |',
    ...manifest.resources.map(
      (resource) =>
        `| \`${resource.name}/\` | ${resource.required ? 'yes' : 'no'} | ${access(resource)} | ${cell(resource.files.map((file) => file.name).join(', ') || 'any')} |`,
    ),
    '',
  ];
  const writes = manifest.contract.outputs.files;
  if (writes.length > 0) {
    lines.push(
      `It may change ${writes.join(', ')}, asking first unless you allow it. Writes follow the permission you grant.`,
      '',
    );
  }
  for (const resource of manifest.resources) {
    if (resource.bundled) {
      lines.push(
        `\`${resource.bundled.path}/\` holds files the author chose to share: ${resource.bundled.provenance}`,
        '',
      );
    }
  }
  return lines;
}

function termsSection(manifest: PackageManifest): string[] {
  return [
    '## Terms',
    '',
    ...(manifest.terms.license ? [`- License: ${manifest.terms.license}.`] : []),
    `- ${manifest.terms.baseModel}`,
    ...manifest.terms.notices.map((notice) => `- ${notice}`),
    '',
  ];
}

/**
 * The model card (`README.md`) a publication writes beside the package, from the package's own
 * manifest and nothing else, so it never claims what the package doesn't record.
 */
export function renderModelCard(manifest: PackageManifest, options: CardOptions): string {
  const { contract, identity } = manifest;
  const agent = slugify(identity.name);
  const revision = options.revision ?? PENDING_REVISION;
  const lines = [
    ...frontMatter(manifest),
    `# ${identity.name}`,
    '',
    contract.summary ?? contract.description,
    '',
    `Version ${identity.version} of an Architect agent: ${manifest.model.adapter ? 'a LoRA adapter for' : 'a harness for'} ${manifest.model.label}, the base model it runs on, that does one job. It runs on your own computer.`,
    '',
    `> ${HOSTED_INFERENCE_NOTE}`,
    '',
    '## Install and run',
    '',
    'With Architect installed (the desktop app includes the `architect` command), and a Hugging Face token if this repository is private:',
    '',
    '```bash',
    `architect install hf://${options.repository} --revision ${revision}`,
    `architect run ${agent}`,
    `architect run ${agent} --input request.json --output result.json --non-interactive`,
    '```',
    '',
    'Installing checks every file against `graduate.json` before anything runs, then asks you for its folders and permissions.',
    '',
    '## The job',
    '',
    contract.description,
    '',
    ...(contract.capabilities.does.length > 0
      ? [...contract.capabilities.does.map((line) => `- ${line}`), '']
      : []),
    `Task types: ${contract.capabilities.taskTypes.map((type) => type.label).join(', ')}.`,
    '',
    ...modelSection(manifest),
    ...harnessSection(manifest),
    ...methodSection(manifest),
    ...evaluationSection(manifest),
    ...limitationsSection(manifest),
    ...dataSection(manifest),
    ...termsSection(manifest),
    '## Files',
    '',
    '- `graduate.json`: the manifest, with the sha256 of every other file.',
    '- `harness/`: instructions, skills, tools and settings.',
    '- `evidence/`: the report card and the history of changes.',
    ...(manifest.model.adapter ? ['- `adapter/`: the LoRA adapter.'] : []),
    ...(manifest.resources.some((resource) => resource.bundled)
      ? ['- `resources/`: files the author chose to share.']
      : []),
    '',
  ];
  return `${lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd()}\n`;
}
