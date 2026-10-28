import {
  ARM_LABELS,
  type ArmRow,
  type BackendTable,
  type ComparisonReport,
  type Counted,
  type Decoding,
  type RuntimeIdentity,
  type TaskSweep,
} from '@architect/shared';
import { percent } from './stats';

/*
 * The report as Markdown for the README: the same object the JSON holds, laid out as tables. No
 * number is computed here that the JSON doesn't carry.
 */

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

function usd(value: number | null): string {
  return value === null ? 'unknown' : `$${value.toFixed(2)}`;
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

function identity(value: RuntimeIdentity): string {
  return [
    `Model ${value.model}`,
    `served by ${value.provider ?? 'not recorded'} on ${value.runtime}`,
    `quantization ${value.quantization ?? 'not recorded'}`,
    `GGUF ${value.ggufSha256 ?? 'none'}`,
    `runtime build ${value.runtimeBuild ?? 'not recorded'}`,
    `chat template ${value.chatTemplate ?? 'not recorded'}`,
    `context ${value.contextLength === null ? 'not recorded' : value.contextLength.toLocaleString('en-US')} tokens`,
  ].join('; ');
}

function sampling(decoding: Decoding | null): string {
  if (decoding === null) return 'not recorded';
  return `temperature ${decoding.temperature}, top_p ${decoding.topP}, top_k ${decoding.topK}, reasoning ${decoding.thinking}, at most ${decoding.maxSteps} model turns and ${decoding.maxOutputTokens} output tokens a turn`;
}

function rowCells(row: ArmRow): string[] {
  return [
    row.label,
    `${count(row.scenarios)}${row.complete ? '' : ', partial'}`,
    row.perType.map((type) => `${type.label} ${type.pass}/${type.total}`).join(', '),
    String(row.refusals),
    row.latencyMs === null ? '-' : `${seconds(row.latencyMs.p50)} / ${seconds(row.latencyMs.p95)}`,
    row.coldStartMs === null ? '-' : seconds(row.coldStartMs),
    row.peakMemory === null
      ? '-'
      : `${bytes(row.peakMemory.processBytes)} RAM, ${bytes(row.peakMemory.gpuBytes)} GPU`,
    short(row.harnessHash),
    short(row.adapterSha256),
  ];
}

function backendSection(backend: BackendTable): string {
  const parts = [`### ${backend.label}`, identity(backend.identity)];
  const samplings = [...new Set(backend.rows.map((row) => sampling(row.sampling)))];
  parts.push(`Sampling and limits: ${samplings.join('; or ')}.`);
  parts.push(
    table(
      [
        'Arm',
        `Locked test, seed ${backend.rows[0]?.seed ?? '-'} (95% Wilson)`,
        'By type',
        'Refused',
        'Latency p50 / p95',
        'Cold start',
        'Peak memory',
        'Harness',
        'Adapter',
      ],
      backend.rows.map(rowCells),
    ),
  );
  if (backend.paired.length > 0) {
    parts.push(
      table(
        [
          'Paired, scenario by scenario',
          'Scenarios',
          'Wins',
          'Losses (regressions)',
          'Both',
          'Neither',
          'By type (wins/losses)',
        ],
        backend.paired.map((pair) => [
          `${ARM_LABELS[pair.a]} vs ${ARM_LABELS[pair.b]}`,
          String(pair.scenarios),
          String(pair.aOnly),
          String(pair.bOnly),
          String(pair.both),
          String(pair.neither),
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
          repeat.label,
          repeat.seeds
            .map((seed) => `seed ${seed.seed}: ${seed.score.pass}/${seed.score.total}`)
            .join(', '),
          count(repeat.everySeed),
          String(repeat.flipped),
        ]),
      ),
    );
  }
  return parts.join('\n\n');
}

function sweepLine(name: string, value: TaskSweep): string {
  return `${name}: ${value.job}, ${count(value.scenarios)} on ${value.tasks} tasks (${value.perType.map((type) => `${type.label} ${type.pass}/${type.total}`).join(', ')}); latency p50 ${value.latencyMs === null ? '-' : seconds(value.latencyMs.p50)}, p95 ${value.latencyMs === null ? '-' : seconds(value.latencyMs.p95)}; ${value.meanUsdPerAttempt === null ? 'price unknown' : `$${value.meanUsdPerAttempt.toFixed(4)} an attempt`}, ${Math.round(value.meanInputTokens).toLocaleString('en-US')} tokens in and ${Math.round(value.meanOutputTokens).toLocaleString('en-US')} out on average.`;
}

/** The whole report as Markdown. */
export function renderMarkdown(report: ComparisonReport): string {
  const parts: string[] = [`# Comparisons: ${report.job.name}`];
  if (report.dryRun) {
    parts.push(
      '**Dry run on fakes. No model was called and nothing was trained; these numbers describe the fakes.**',
    );
  }
  parts.push(
    `Made ${report.generatedAt}${report.commit === null ? '' : ` at commit ${report.commit}`}, from stored records only. Splits seed ${report.job.splitsSeed}: ${report.job.counts.calibration} calibration, ${report.job.counts.train} train, ${report.job.counts.dev} dev and ${report.job.counts.test} locked-test tasks. Mentoring seed ${report.plan.mentoringSeed}; locked-test seeds ${report.plan.testSeeds.join(' and ')}.`,
  );
  if (report.calibration !== null) parts.push(sweepLine('Calibration', report.calibration));
  if (report.regression !== null) parts.push(sweepLine('Regression check', report.regression));

  parts.push('## Arms');
  parts.push(
    table(
      [
        '#',
        'Arm',
        'Status',
        'Spark',
        'Student',
        'Compute',
        'Examples / trained tokens',
        'Dev before, after',
      ],
      report.arms.map((arm) => [
        String(arm.priority),
        arm.label,
        arm.status === 'not_run' ? 'not run' : arm.status,
        `${usd(arm.spent.sparkUsd)} of ${cap(arm.caps.sparkUsd)}, ${arm.spent.sparkInputTokens.toLocaleString('en-US')} in / ${arm.spent.sparkOutputTokens.toLocaleString('en-US')} out`,
        `${usd(arm.spent.studentUsd)} of ${cap(arm.caps.studentUsd)}, ${arm.spent.studentAttempts} attempts`,
        `${usd(arm.spent.computeUsd)}${arm.spent.computeSettled ? '' : ' (at most)'}, ${arm.spent.computeMinutes.toFixed(0)} min`,
        `${arm.spent.examples} / ${arm.spent.trainedTokens.toLocaleString('en-US')}`,
        arm.dev.baseline === null
          ? '-'
          : `${arm.dev.baseline.pass}/${arm.dev.baseline.total}, ${arm.dev.final === null ? '-' : `${arm.dev.final.pass}/${arm.dev.final.total}`}`,
      ]),
    ),
  );
  for (const arm of report.arms) {
    const lines = [
      ...(arm.reason === null
        ? []
        : [`${arm.status === 'not_run' ? 'Not run' : 'Why'}: ${arm.reason}`]),
      ...arm.notes,
      ...(arm.frozen === null
        ? []
        : [
            `Frozen: harness version ${arm.frozen.harnessVersion} (${short(arm.frozen.harnessHash)}) on ${arm.frozen.backend}${arm.frozen.adapter === null ? ', no adapter' : `, adapter ${arm.frozen.adapter.id} (${short(arm.frozen.adapter.sha256)}) at scale ${arm.frozen.adapter.scale} on base ${arm.frozen.adapter.baseDigest ?? 'not recorded'}${arm.frozen.adapter.standIn ? ', a stand-in' : ''}`}; locked-test seeds ${arm.frozen.testSeeds.join(', ')}.`,
          ]),
      ...arm.experiments.map((experiment) => {
        const regressed = experiment.regressions
          .map((item) => `${item.type} (${item.before} to ${item.after})`)
          .join(', ');
        const reason = experiment.reason.endsWith('.')
          ? experiment.reason
          : `${experiment.reason}.`;
        return `Round ${experiment.round} (${experiment.kind}) ${experiment.disposition}: ${experiment.title}. ${reason}${regressed === '' ? '' : ` Dev regressed on ${regressed}.`}`;
      }),
    ];
    if (lines.length > 0) parts.push(`**${arm.label}.** ${lines.join(' ')}`);
  }

  parts.push('## Locked test, one table per backend');
  if (report.backends.length === 0) parts.push('No locked test has run yet.');
  for (const backend of report.backends) parts.push(backendSection(backend));

  if (report.adapters.length > 0) {
    parts.push('## Adapter configurations on one llama-server (dev, selected by the keep rule)');
    parts.push(
      table(
        [
          'Arm',
          'Round',
          'Configuration',
          'Harness version',
          'Adapter',
          'Seeds',
          'Dev',
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
          count(cell.score),
          `${seconds(cell.latencyMs.p50)} / ${seconds(cell.latencyMs.p95)}`,
          cell.provenance,
        ]),
      ),
    );
  }

  if (report.projection !== null) {
    const { projection } = report;
    parts.push('## Measurement model and projection');
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
          'Spark calls / tasks',
          'Student',
          'Spark',
          'Compute',
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
      `Funded: student ${usd(projection.funded.studentUsd)} of ${usd(projection.caps.studentUsd)}, Spark ${usd(projection.funded.sparkUsd)} of ${usd(projection.caps.sparkUsd)}, compute ${usd(projection.funded.computeUsd)} of ${usd(projection.caps.computeUsd)}, local GPU ${Math.ceil(projection.funded.localMinutes)} of ${Math.floor(projection.caps.localMinutes)} minutes, about ${Math.ceil(projection.funded.wallMinutes)} minutes of wall clock.`,
    );
  }

  parts.push('## Disclosures');
  parts.push(report.disclosures.map((line) => `- ${line}`).join('\n'));
  return `${parts.join('\n\n')}\n`;
}
