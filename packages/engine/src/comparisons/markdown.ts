import {
  ARM_LABELS,
  armInSentence,
  type ArmId,
  type ArmReport,
  type ArmRow,
  type BackendTable,
  type ComparisonReport,
  type Counted,
  type PassDifference,
  type PinnedInputs,
  type RuntimeIdentity,
  type Score,
  type TaskSweep,
} from '@architect/shared';
import { percent } from './stats';

/*
 * The report as Markdown for the README: the same object the JSON holds, laid out as tables. No
 * figure is worked out here that the JSON doesn't carry; what is done here is only choosing the
 * words and showing the dollars so that the figures shown add up.
 */

/** The arms whose graduate carries trained weights. */
const ADAPTER_ARMS: readonly ArmId[] = ['weights-one-shot', 'weights-targeted'];

function table(header: readonly string[], rows: readonly (readonly string[])[]): string {
  const line = (cells: readonly string[]) =>
    `| ${cells.map((cell) => cell.replace(/\|/g, '/')).join(' | ')} |`;
  return [line(header), line(header.map(() => '---')), ...rows.map(line)].join('\n');
}

function count(value: Counted): string {
  if (value.total === 0) return '-';
  const interval =
    value.wilson95 === null
      ? ''
      : ` (${percent(value.wilson95.low)} to ${percent(value.wilson95.high)})`;
  return `${value.pass}/${value.total}, ${percent(value.rate)}${interval}`;
}

function score(value: Score): string {
  return `${value.pass}/${value.total}`;
}

function usd(value: number | null): string {
  return value === null ? 'unknown' : `$${value.toFixed(2)}`;
}

/** Dollars to a tenth of a cent, as the money section shows them so they can be added up. */
function usd4(value: number | null): string {
  return value === null ? 'unknown' : dollars(tenths(value));
}

/** A cap, where null means the arm had none of that kind. */
function cap(value: number | null): string {
  return value === null ? 'no cap' : `$${value.toFixed(2)}`;
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`;
}

function bytes(value: number | null): string {
  return value === null ? '-' : `${(value / 1024 ** 3).toFixed(2)} GiB`;
}

function short(hash: string | null): string {
  if (hash === null) return '-';
  const hex = hash.replace(/^sha256[:-]/, '');
  return `\`${hex.slice(0, 12)}\``;
}

/**
 * "a", "a and b", "a, b and c". Names that hold commas themselves ("Spark reference, blank
 * harness") are separated by semicolons, so a reader can tell where one ends.
 */
function list(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  const commas = items.some((item) => item.includes(','));
  const last = items.at(-1);
  return commas
    ? `${items.slice(0, -1).join('; ')}; and ${last}`
    : `${items.slice(0, -1).join(', ')} and ${last}`;
}

function plural(n: number, noun: string): string {
  return `${n.toLocaleString('en-US')} ${noun}${n === 1 ? '' : 's'}`;
}

/** A share of the scenarios as signed percentage points: +3.3, -10.6, 0.0. */
function points(share: number): string {
  const value = Math.round(share * 1000) / 10;
  return `${value > 0 ? '+' : ''}${value.toFixed(1)}`;
}

function difference(value: PassDifference): string {
  return `${points(value.rate)} (${points(value.low)} to ${points(value.high)})`;
}

function identity(value: RuntimeIdentity): string {
  return [
    `Model ${value.model}`,
    `served by ${value.provider ?? 'not recorded'} on ${value.runtime}`,
    `quantization ${value.quantization ?? 'not recorded'}`,
    `GGUF ${value.ggufSha256 ?? 'none'}`,
    `runtime build ${value.runtimeBuild ?? 'not recorded'}`,
    `chat template ${value.chatTemplate ?? 'not recorded'}`,
    `context ${value.contextLength === null ? 'not recorded' : `${value.contextLength.toLocaleString('en-US')} tokens`}`,
  ].join('; ');
}

/** What each row ran with, from the records of its frozen harness: one row per row of results. */
function settingsTable(rows: readonly ArmRow[]): string {
  return table(
    ['Arm', 'Temperature', 'top_p', 'top_k', 'Reasoning', 'Turn limit', 'Output tokens a turn'],
    rows.map((row) => {
      const { sampling } = row;
      return sampling === null
        ? [row.label, 'not recorded', '-', '-', '-', '-', '-']
        : [
            row.label,
            String(sampling.temperature),
            String(sampling.topP),
            String(sampling.topK),
            sampling.thinking,
            String(sampling.maxSteps),
            sampling.maxOutputTokens.toLocaleString('en-US'),
          ];
    }),
  );
}

/** The target as observed counts, never as proven reliability. */
function target(row: ArmRow): string {
  const { passTarget } = row;
  const goal = `${percent(passTarget.passRate)} target as observed (${passTarget.needed} of ${passTarget.of} needed)`;
  if (!row.complete) return `partial, so it meets no ${goal}`;
  return passTarget.met ? `meets the ${goal}` : `below the ${goal}`;
}

function rowCells(row: ArmRow, adapters: boolean): string[] {
  return [
    row.label,
    `${count(row.scenarios)}${row.complete ? '' : ', partial'}`,
    target(row),
    row.perType.map((type) => `${type.label} ${type.pass}/${type.total}`).join(', '),
    String(row.refusals),
    row.latencyMs === null ? '-' : `${seconds(row.latencyMs.p50)} / ${seconds(row.latencyMs.p95)}`,
    row.coldStartMs === null ? '-' : seconds(row.coldStartMs),
    row.peakMemory === null
      ? '-'
      : `${bytes(row.peakMemory.processBytes)} RAM, ${bytes(row.peakMemory.gpuBytes)} GPU`,
    short(row.harnessHash),
    ...(adapters ? [short(row.adapterSha256)] : []),
  ];
}

/**
 * Each arm at each organization, for a job with organizations: the organizations it trained on,
 * then each one it never saw, labeled synthetic or real; a cell is the organization's total and
 * each skill's. Null for a one-organization job.
 */
function orgTable(rows: readonly ArmRow[]): string | null {
  const orgs = new Map<string, string>();
  for (const result of rows.flatMap((row) => row.perOrg ?? [])) {
    orgs.set(
      result.org,
      `${result.orgName} (${result.seen ? 'taught on' : 'never seen'}, ${result.synthetic ? 'synthetic' : 'real'})`,
    );
  }
  if (orgs.size === 0) return null;
  return table(
    ['By organization', ...orgs.values()],
    rows.map((row) => [
      row.label,
      ...[...orgs.keys()].map((org) => {
        const here = (row.perOrg ?? []).filter((result) => result.org === org);
        if (here.length === 0) return '-';
        const pass = here.reduce((sum, result) => sum + result.pass, 0);
        const total = here.reduce((sum, result) => sum + result.total, 0);
        return `${pass}/${total} (${here.map((result) => `${result.label} ${result.pass}/${result.total}`).join(', ')})`;
      }),
    ]),
  );
}

function backendSection(backend: BackendTable, adapters: boolean): string {
  const seed = backend.rows[0]?.seed ?? '-';
  const parts = [`### ${backend.label}`, identity(backend.identity)];
  parts.push(
    'Settings each row ran with. The harness sets these, so each row compares a whole configuration: the harness text together with its sampling and limits.',
  );
  parts.push(settingsTable(backend.rows));
  parts.push(
    table(
      [
        'Arm',
        `Final test, seed ${seed} (95% Wilson)`,
        'Target',
        'By type',
        'Refused',
        'Latency p50 / p95',
        'Cold start',
        'Peak memory',
        'Harness',
        ...(adapters ? ['Adapter'] : []),
      ],
      backend.rows.map((row) => rowCells(row, adapters)),
    ),
  );
  const orgs = orgTable(backend.rows);
  if (orgs !== null) parts.push(orgs);
  if (backend.paired.length > 0) {
    parts.push(
      table(
        [
          `Paired under seed ${seed}, scenario by scenario`,
          'Scenarios',
          'Wins',
          'Losses (regressions)',
          'Both',
          'Neither',
          'First less second, in percentage points (95% interval)',
          'By type (wins/losses)',
        ],
        backend.paired.map((pair) => [
          pair.label,
          String(pair.scenarios),
          String(pair.aOnly),
          String(pair.bOnly),
          String(pair.both),
          String(pair.neither),
          difference(pair.difference),
          pair.byType.map((type) => `${type.type} ${type.aOnly}/${type.bOnly}`).join(', '),
        ]),
      ),
    );
  }
  if (backend.repeats.length > 0) {
    parts.push(
      table(
        ['Repeats', 'Each seed', 'Passed under every seed', 'Results that differed'],
        backend.repeats.map((repeat) => [
          `${repeat.label}${repeat.complete ? '' : ' (partial)'}`,
          repeat.seeds
            .map((each) => `seed ${each.seed}: ${each.score.pass}/${each.score.total}`)
            .join(', '),
          `${count(repeat.everySeed)}${repeat.complete ? '' : ', of the scenarios every seed ran'}`,
          String(repeat.flipped),
        ]),
      ),
    );
  }
  return parts.join('\n\n');
}

/** The files the comparison measured on, by the sha256 of their bytes. */
function pinnedLine(inputs: NonNullable<ComparisonReport['inputs']>): string {
  const pin = (value: PinnedInputs) =>
    `${value.name} (${value.jobId}): job.json ${short(value.job)}, tasks ${short(value.tasks)}, data ${short(value.data)}, checker ${short(value.checker)}`;
  return `Pinned when the plan was made, and checked on every run since: ${pin(inputs.job)}${inputs.regression === null ? '' : `; the regression check's ${pin(inputs.regression)}`}.`;
}

/**
 * The money section rounds every figure once, to a tenth of a cent, and takes every difference
 * between the rounded figures, so the figures it shows add up whatever the rounding was.
 */
const tenths = (dollars: number) => Math.round(dollars * 10_000);
const dollars = (units: number) => `$${(units / 10_000).toFixed(4)}`;

/** How a figure stands against the attempts' recorded costs, by the step between the two. */
function against(step: number): string {
  if (step === 0) return 'the same as the attempts record';
  return `${dollars(Math.abs(step))} ${step > 0 ? 'more' : 'less'} than the attempts record`;
}

/** What was spent: the teacher and compute from their ledgers, and the student's three counts. */
function moneySection(report: ComparisonReport, names: ModelNames): string[] {
  const { mentor, student } = names;
  const { totals, credit, calibration, regression } = report;
  const { studentUsd, studentParts } = totals;
  const recorded = studentUsd === null ? null : tenths(studentUsd);
  const reference = report.arms.some(
    (arm) => arm.arm.startsWith('reference') && arm.status !== 'not_run',
  );
  const parts = [
    `the arms ${usd4(studentParts.armsUsd)}`,
    ...(calibration === null ? [] : [`the calibration ${usd4(studentParts.calibrationUsd)}`]),
    ...(regression === null ? [] : [`the regression check ${usd4(studentParts.regressionUsd)}`]),
  ];
  const bullets = [
    `**${mentor}: ${usd4(totals.sparkUsd)}.** The cost ledger: every ${mentor} call${reference ? `, and ${mentor} doing the tasks itself as a reference` : ''}. ${mentor} calls are not in the request journal.`,
    totals.computeSettled
      ? `**Compute: ${usd4(totals.computeUsd)}.** ${totals.computeUsd === 0 ? 'No training job was paid for.' : 'The training jobs, as they ended.'}`
      : `**Compute: ${usd4(totals.computeUsd)} at most.** A training job had not ended, so this is its whole authorization and the cost may be lower.`,
    recorded === null
      ? `**Hosted ${student}, recorded by its attempts: unknown.** The cost of some attempt was not recorded.`
      : `**Hosted ${student}, recorded by its attempts: ${dollars(recorded)}.** The cost written down with each attempt, every dollar once: ${list(parts)}.`,
  ];
  const lead = `What was spent, from the records. The projection made before the run is further down, apart from this, and none of it is counted here. The three figures for hosted ${student} count the same requests in different ways, so they are not added together.`;
  const bulleted = () => bullets.map((bullet) => `- ${bullet}`).join('\n');
  if (credit === null || credit.requests === 0) {
    return [lead, bulleted(), 'The request journal holds no hosted request.'];
  }
  const settled = tenths(credit.settledUsd);
  const journal = tenths(credit.totalUsd);
  const settledRequests = credit.requests - credit.uncertainRequests - credit.inFlightRequests;
  const billed =
    credit.billedRequests === settledRequests
      ? 'all of them billed by the provider'
      : `${credit.billedRequests.toLocaleString('en-US')} of them billed by the provider and the rest at the listed price of the usage reported`;
  const held = credit.uncertainRequests + credit.inFlightRequests;
  bullets.push(
    `**Hosted ${student}, settled by the provider: ${dollars(settled)}.** The request journal's ${plural(settledRequests, 'request')} with a known charge, ${billed}.${
      recorded === null
        ? ''
        : ` That is ${against(settled - recorded)}${settled > recorded ? ': the journal writes down every request before it is sent, so it also holds requests that no recorded attempt keeps the cost of (an attempt that failed or was cut off and was made again)' : ''}.`
    }`,
    held === 0
      ? `**Hosted ${student}, uncertain: $0.0000.** No request was cut off.`
      : `**Hosted ${student}, uncertain: ${dollars(journal - settled)}.** The journal's ${plural(held, 'request')} that a crash or a failure cut off, whose charge is not known, ${held === 1 ? '' : 'each '}counted at the most it could have cost.`,
  );
  return [
    lead,
    bulleted(),
    `The journal counts ${dollars(journal)} in all, settled plus uncertain, of the ${usd(credit.capUsd)} set aside for hosted ${student}${recorded === null ? '' : `: ${against(journal - recorded)}`}.`,
  ];
}

/** A sweep on the bare student outside any arm, with what it was for. */
function sweepLine(value: TaskSweep, about: string): string {
  return `${value.label} (${about}): ${value.job}, ${count(value.scenarios)} on ${value.tasks} tasks (${value.perType.map((type) => `${type.label} ${type.pass}/${type.total}`).join(', ')}); latency p50 ${value.latencyMs === null ? '-' : seconds(value.latencyMs.p50)}, p95 ${value.latencyMs === null ? '-' : seconds(value.latencyMs.p95)}; ${value.meanUsdPerAttempt === null ? 'price unknown' : `$${value.meanUsdPerAttempt.toFixed(4)} an attempt`}, ${Math.round(value.meanInputTokens).toLocaleString('en-US')} tokens in and ${Math.round(value.meanOutputTokens).toLocaleString('en-US')} out on average.`;
}

/**
 * Which seeds ran and for whom: the plan declared them before any arm ran, and a seed with no
 * result under it was not run.
 */
function seedsParagraph(plan: ComparisonReport['plan'], arms: readonly ArmReport[]): string {
  const name = (id: ArmId) => arms.find((arm) => arm.arm === id)?.label ?? ARM_LABELS[id];
  const ran = plan.seedResults.filter((item) => item.arms.length > 0);
  const declared = `Final-test seeds declared in the plan before any arm ran: ${list(plan.testSeeds.map(String))}.`;
  if (ran.length === 0) return `${declared} No final test has run, so no seed has a result yet.`;
  const sentences = plan.seedResults.map((item, index) =>
    item.arms.length > 0
      ? `Seed ${item.seed} ran for ${list(item.arms.map(name))}.`
      : `Seed ${item.seed} was declared${index > 0 ? ' for the decoding repeat' : ''} and was not run, so no result in this report is under it.`,
  );
  return [declared, ...sentences].join(' ');
}

/** What each frozen agent is set to run on, and where its numbers come from. */
function frozenLines(
  arm: ArmReport,
  adapters: boolean,
  backends: readonly BackendTable[],
  student: string,
): string[] {
  const { frozen } = arm;
  if (frozen === null) return [];
  const runtime =
    frozen.backend === 'ollama'
      ? 'Ollama'
      : frozen.backend === 'llama.cpp'
        ? 'llama-server'
        : frozen.backend;
  const adapter =
    frozen.adapter === null
      ? adapters
        ? ', no adapter'
        : ''
      : `, adapter ${frozen.adapter.id} (${short(frozen.adapter.sha256)}) at scale ${frozen.adapter.scale} on base ${frozen.adapter.baseDigest ?? 'not recorded'}${frozen.adapter.standIn ? ', a stand-in' : ''}`;
  const local = backends.filter(
    (table) =>
      (table.backend === 'local-ollama' || table.backend === 'local-llama.cpp') &&
      arm.measuredOn.includes(table.backend),
  );
  const hosted = arm.measuredOn.includes('hosted');
  const measured =
    local.length === 0
      ? hosted
        ? `All of its measurements here are from hosted ${student}; that local build was not measured.`
        : 'It has no final-test result here, so that local build was not measured either.'
      : `Its final test ${hosted ? 'also ' : ''}ran on this computer; see ${local.length === 1 ? 'the table' : 'the tables'} ${list(local.map((table) => `"${table.label}"`))}.`;
  return [
    `Frozen: harness version ${frozen.harnessVersion} (${short(frozen.harnessHash)})${adapter}.`,
    `Once installed, it is set to run on \`${frozen.localModel}\` on ${runtime}.`,
    measured,
  ];
}

/** How an arm's rounds ended: the rounds it used of the most it was allowed, and why it stopped. */
function roundsCell(arm: ArmReport): string {
  if (arm.rounds === null) return '-';
  const allowed = arm.caps.rounds === null ? '' : ` of ${arm.caps.rounds}`;
  return `${arm.rounds.used}${allowed}${arm.rounds.ended === null ? '' : `, ${arm.rounds.ended}`}`;
}

/** The last kept round's own before and after, which are on one scale. */
function keptCell(arm: ArmReport): string {
  const { kept } = arm.dev;
  if (kept === null) return arm.rounds === null || arm.status === 'not_run' ? '-' : 'none kept';
  const pair =
    kept.before === null || kept.after === null
      ? '-'
      : `${score(kept.before)} to ${score(kept.after)}`;
  return `round ${kept.round}: ${pair}${kept.kind === 'draft' ? ' (kept without a check)' : ''}`;
}

/** How to read the development columns of the arms table, for the arms the report has. */
function devNote(arms: readonly ArmReport[]): string {
  const sentences = ['The first check-task measurement is one run over the check tasks.'];
  if (arms.some((arm) => arm.dev.kept !== null && arm.dev.kept.kind !== 'draft')) {
    sentences.push(
      "A round that went through the keep rule is decided on its confirmation: the check tasks again on new seeds, over more than one run, so its before and after are out of a larger total. Compare a round's before with its after, not with the first measurement.",
    );
  }
  if (arms.some((arm) => arm.dev.kept?.kind === 'draft')) {
    sentences.push(
      'A one-shot draft is kept without a check, so its before and after are one run each.',
    );
  }
  return sentences.join(' ');
}

/** The teacher's and the student's names, as the comparison's job labels them. */
export interface ModelNames {
  mentor: string;
  student: string;
}

/** The defaults' names (decision 094), for a report made before the models were chosen. */
const DEFAULT_NAMES: ModelNames = { mentor: 'Spark', student: 'Glimmer' };

/** The whole report as Markdown. */
export function renderMarkdown(
  report: ComparisonReport,
  names: ModelNames = DEFAULT_NAMES,
): string {
  const { mentor, student } = names;
  const adapters = report.arms.some(
    (arm) => ADAPTER_ARMS.includes(arm.arm) && arm.status !== 'not_run',
  );
  const parts: string[] = [`# Comparisons: ${report.job.name}`];
  if (report.dryRun) {
    parts.push(
      '**Dry run on fakes. No model was called and nothing was trained; these numbers describe the fakes.**',
    );
  }
  parts.push(
    `Made ${report.generatedAt}${report.commit === null ? '' : ` at commit ${report.commit}`}, from stored records only. Splits seed ${report.job.splitsSeed}: ${report.job.counts.calibration} calibration, ${report.job.counts.train} train, ${report.job.counts.dev} check and ${report.job.counts.test} final-test tasks. Mentoring seed ${report.plan.mentoringSeed}. ${report.plan.releasedAt === null ? 'Development is still open: no final test has been released.' : `Development closed at ${report.plan.releasedAt}, when the final tests were released; no arm developed after it.`}`,
  );
  parts.push(seedsParagraph(report.plan, report.arms));
  // What the plan never asked for is said to be not run, so a reader doesn't look for it.
  const absent = [
    ...report.plan.order
      .filter((id) => !report.arms.some((arm) => arm.arm === id))
      .map((id) => ARM_LABELS[id]),
    ...(report.inputs !== null && report.inputs.regression === null
      ? ['the runtime regression check']
      : []),
  ];
  if (absent.length > 0) parts.push(`Not in this comparison, so not run: ${list(absent)}.`);
  parts.push(
    adapters
      ? `Adapter protocol: ${report.plan.adapterProtocol}.`
      : 'Every reported agent is harness-only: none has trained weights.',
  );
  if (report.inputs !== null) parts.push(pinnedLine(report.inputs));
  if (report.calibration !== null)
    parts.push(
      sweepLine(
        report.calibration,
        `${student} alone on the calibration tasks, run first to price an attempt`,
      ),
    );
  if (report.regression !== null)
    parts.push(
      sweepLine(
        report.regression,
        `${student} alone on check tasks of a second job, to check the runtime`,
      ),
    );

  parts.push('## Money');
  parts.push(...moneySection(report, names));

  parts.push('## Arms');
  parts.push(
    table(
      [
        '#',
        'Arm',
        'Status',
        'Rounds used of the most allowed, and why training ended',
        'Check tasks, first measurement',
        'Check tasks, last kept round: before to after',
      ],
      report.arms.map((arm) => [
        String(arm.priority),
        arm.label,
        arm.status === 'not_run' ? 'not run' : arm.status,
        roundsCell(arm),
        arm.dev.baseline === null ? '-' : score(arm.dev.baseline),
        keptCell(arm),
      ]),
    ),
  );
  parts.push(devNote(report.arms));
  parts.push(
    table(
      [
        '#',
        'Arm',
        `${mentor}: spent of its cap, tokens`,
        `${student}: spent of its cap, attempts`,
        'Compute',
        'Examples / trained tokens',
      ],
      report.arms.map((arm) => [
        String(arm.priority),
        arm.label,
        `${usd(arm.spent.sparkUsd)} of ${cap(arm.caps.sparkUsd)}, ${arm.spent.sparkInputTokens.toLocaleString('en-US')} in / ${arm.spent.sparkOutputTokens.toLocaleString('en-US')} out`,
        `${usd(arm.spent.studentUsd)} of ${cap(arm.caps.studentUsd)}, ${arm.spent.studentAttempts} attempts`,
        `${usd(arm.spent.computeUsd)}${arm.spent.computeSettled ? '' : ' (at most)'}, ${arm.spent.computeMinutes.toFixed(0)} min`,
        `${arm.spent.examples} / ${arm.spent.trainedTokens.toLocaleString('en-US')}`,
      ]),
    ),
  );
  for (const arm of report.arms) {
    const lines = [
      ...(arm.reason === null
        ? []
        : [`${arm.status === 'not_run' ? 'Not run' : 'Why'}: ${arm.reason}`]),
      ...arm.notes,
      ...(arm.cumulative === null || arm.cumulative.builtOn.length === 0
        ? []
        : [
            `Its graduate's cumulative development cost, with the ${arm.cumulative.builtOn.map((other) => armInSentence(ARM_LABELS[other])).join(' and ')} arm's: ${mentor} ${usd(arm.cumulative.sparkUsd)}, ${student} ${usd(arm.cumulative.studentUsd)}, compute ${usd(arm.cumulative.computeUsd)}.`,
          ]),
      ...frozenLines(arm, adapters, report.backends, student),
      ...arm.experiments.map((experiment) => {
        const regressed = experiment.regressions
          .map((item) => `${item.type} (${item.before} to ${item.after})`)
          .join(', ');
        const reason = experiment.reason.endsWith('.')
          ? experiment.reason
          : `${experiment.reason}.`;
        return `Round ${experiment.round} (${experiment.kind}) ${experiment.disposition}: ${experiment.title}. ${reason}${regressed === '' ? '' : ` Check tasks regressed on ${regressed}.`}`;
      }),
    ];
    if (lines.length > 0) parts.push(`**${arm.label}.** ${lines.join(' ')}`);
  }

  parts.push('## Final test, one table per backend');
  if (report.backends.length === 0) parts.push('No final test has run yet.');
  for (const backend of report.backends) parts.push(backendSection(backend, adapters));

  if (report.adapters.length > 0) {
    parts.push('## Development only: adapter configurations on one llama-server');
    parts.push(
      'Check-task measurements the keep rule picked from, and smoke checks on train tasks. None of these is a final-test result, and none is claimed.',
    );
    parts.push(
      table(
        [
          'Arm',
          'Round',
          'Configuration',
          'Harness version',
          'Adapter',
          'Seeds',
          'Tasks',
          'Score',
          'Latency p50 / p95',
          'Where it comes from',
        ],
        report.adapters.map((cell) => [
          ARM_LABELS[cell.arm],
          String(cell.round),
          cell.label,
          String(cell.harnessVersion),
          cell.adapter === null ? 'none' : `${cell.adapter.id} at ${cell.adapter.scale}`,
          cell.seeds.join(', '),
          cell.split === 'dev' ? 'check tasks' : 'train (smoke check)',
          count(cell.score),
          `${seconds(cell.latencyMs.p50)} / ${seconds(cell.latencyMs.p95)}`,
          cell.provenance,
        ]),
      ),
    );
  }

  if (report.projection !== null) {
    const { projection } = report;
    parts.push('## Projection made before the run, not what was spent');
    parts.push(
      'These are estimates, made from the calibration attempts before any arm spent. Nothing here was spent; what was spent is under Money and Arms.',
    );
    parts.push(
      table(
        ['Input', 'Value', 'Source', 'Note'],
        projection.inputs.map((input) => [
          input.name,
          `${input.unit === 'USD' ? `$${input.value.toFixed(4)}` : input.value.toFixed(1)} ${input.unit === 'USD' ? '' : input.unit}`.trim(),
          input.source,
          input.note,
        ]),
      ),
    );
    parts.push(
      table(
        [
          'Arm',
          'Hosted attempts',
          'Local attempts',
          `${mentor} calls / tasks`,
          `Projected ${student}`,
          `Projected ${mentor}`,
          'Projected compute',
          'Local GPU',
          'Wall clock',
          'Funded',
        ],
        projection.arms.map((arm) => [
          ARM_LABELS[arm.arm],
          String(arm.hostedAttempts),
          String(arm.localAttempts),
          `${arm.sparkCalls} / ${arm.sparkAttempts}`,
          usd(arm.studentUsd),
          usd(arm.sparkUsd),
          usd(arm.computeUsd),
          `${Math.ceil(arm.localMinutes)} min`,
          `${Math.ceil(arm.wallMinutes)} min`,
          arm.funded ? 'yes' : `no: ${arm.reason ?? ''}`,
        ]),
      ),
    );
    parts.push(
      `Projected for the funded arms: ${student} ${usd(projection.funded.studentUsd)} of ${usd(projection.caps.studentUsd)}, ${mentor} ${usd(projection.funded.sparkUsd)} of ${usd(projection.caps.sparkUsd)}, compute ${usd(projection.funded.computeUsd)} of ${usd(projection.caps.computeUsd)}, local GPU ${Math.ceil(projection.funded.localMinutes)} of ${Math.floor(projection.caps.localMinutes)} minutes, about ${Math.ceil(projection.funded.wallMinutes)} minutes of wall clock.`,
    );
  }

  parts.push('## Disclosures');
  parts.push(report.disclosures.map((line) => `- ${line}`).join('\n'));
  return `${parts.join('\n\n')}\n`;
}
