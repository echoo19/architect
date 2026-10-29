import type { ReportCard, RuleReport, Score } from '@architect/shared';
import {
  branchLine,
  METHOD_LABELS,
  passageOrigin,
  ruleScoreNote,
  teachingLine,
} from '@architect/shared';

const percent = (fraction: number): string => `${Number((fraction * 100).toFixed(1))}%`;

const share = (score: Score): string =>
  score.total === 0 ? 'n/a' : percent(score.pass / score.total);

const count = (value: number): string => value.toLocaleString('en-US');

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

function duration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${Number(seconds.toFixed(1))} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

function dollars(usd: number): string {
  return usd > 0 && usd < 0.01 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(2)}`;
}

const cell = (text: string): string => text.replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');

function met(isMet: boolean): string {
  return isMet ? 'Met.' : 'Not met.';
}

const RUNTIME_NAMES: Record<string, string> = {
  ollama: 'Ollama',
  openai_compatible: 'an OpenAI-compatible server',
};

/** The student the locked test ran on: the local build, or the hosted copy. */
function studentLine(report: ReportCard): string {
  const { student } = report;
  const where =
    report.testedOn === 'hosted'
      ? 'a hosted copy'
      : `local through ${RUNTIME_NAMES[student.runtime] ?? student.runtime}`;
  const build = student.quantization === undefined ? '' : `, ${student.quantization}`;
  return `- Student: ${student.label} (${student.model}, ${where}${build})`;
}

/**
 * The report card as Markdown for people: the result first, then where it came from and what
 * it cost. Everything it says comes from the report; nothing is inferred.
 */
export function renderReportMarkdown(report: ReportCard): string {
  const { test, dev, cost, requirements } = report;
  const sections: string[] = [];

  const headline =
    test.score.total === 0
      ? 'No locked test tasks were run.'
      : `**${test.score.pass} of ${test.score.total} locked test tasks passed (${share(test.score)}).** ` +
        `The target was ${percent(requirements.passRate.target)}, so the pass rate requirement was ${
          requirements.passRate.met ? 'met' : 'not met'
        }.`;
  sections.push(
    `# ${report.name}: report card`,
    headline,
    ...(report.tasks?.rules === undefined ? [] : [ruleScoreNote(report.mentor.label)]),
    [
      studentLine(report),
      `- Mentor: ${report.mentor.label} (${report.mentor.model})`,
      `- Method: ${METHOD_LABELS[report.method]}`,
      `- Created: ${report.createdAt.slice(0, 10)}`,
    ].join('\n'),
  );

  const rows = test.perType.map(
    (row) =>
      `| ${cell(row.refused ? `${row.label} (refused)` : row.label)} | ${row.pass} | ${row.total} | ${share(row)} |`,
  );
  rows.push(`| All tasks | ${test.score.pass} | ${test.score.total} | ${share(test.score)} |`);
  const refusalNote =
    test.refusals > 0
      ? `\n\nThe graduate refused ${test.refusals} supported ${plural(test.refusals, 'task', 'tasks')} during the test. Refusals count as failures.`
      : '';
  sections.push(
    '## Results by task type',
    `| Task type | Passed | Total | Pass rate |\n| --- | ---: | ---: | ---: |\n${rows.join('\n')}${refusalNote}`,
  );

  sections.push(
    '## Speed',
    `The median answer took ${duration(test.latencyMs.p50)}. The slowest 5% took ${duration(test.latencyMs.p95)} or longer.`,
  );

  const training = [
    `- Rounds: ${cost.rounds}`,
    `- Mentor cost: ${dollars(cost.mentorUsd)} (${count(cost.mentorInputTokens)} input tokens, ${count(cost.mentorOutputTokens)} output tokens)`,
    ...(cost.studentUsd === undefined
      ? []
      : [`- Hosted student cost: ${dollars(cost.studentUsd)}, billed by the student's host`]),
    `- Training time: ${duration(cost.wallMs)}`,
  ];
  if (dev.baseline && dev.final) {
    training.push(
      `- Dev tasks passed: ${share(dev.baseline)} at the start (${dev.baseline.pass} of ${dev.baseline.total}), ${share(dev.final)} at the end (${dev.final.pass} of ${dev.final.total})`,
    );
  }
  if (dev.final && dev.final.total > 0 && test.score.total > 0) {
    const devRate = dev.final.pass / dev.final.total;
    const testRate = test.score.pass / test.score.total;
    const gap = Number((Math.abs(devRate - testRate) * 100).toFixed(1));
    training.push(
      `- Dev pass rate ${percent(devRate)}, locked test pass rate ${percent(testRate)}: a gap of ${gap} ${plural(gap, 'point', 'points')}`,
    );
  }
  sections.push('## Training', training.join('\n'));

  sections.push(
    '## Refused task types',
    report.refusedTypes.length === 0
      ? 'None. The graduate attempts every task type.'
      : report.refusedTypes.map((item) => `- ${item.label}: ${item.reason}`).join('\n'),
  );

  sections.push(
    '## What helped most',
    report.topInterventions.length === 0
      ? 'No single change is credited with a gain.'
      : report.topInterventions
          .map(
            (item, index) =>
              `${index + 1}. Round ${item.round}, "${item.title}": ${item.delta >= 0 ? '+' : ''}${item.delta} dev ${plural(Math.abs(item.delta), 'pass', 'passes')}${item.runs === undefined ? '' : ` over ${item.runs} runs`}`,
          )
          .join('\n'),
  );

  const requirementLines = [
    `- Pass rate: target ${percent(requirements.passRate.target)}, result ${percent(requirements.passRate.actual)}. ${met(requirements.passRate.met)}`,
  ];
  if (requirements.p95LatencyMs) {
    const { target, actual, met: isMet } = requirements.p95LatencyMs;
    requirementLines.push(
      `- 95th percentile answer time: target ${duration(target)}, result ${duration(actual)}. ${met(isMet)}`,
    );
  }
  sections.push('## Requirements', requirementLines.join('\n'));

  if (report.overclaim !== null) {
    sections.push(
      "## The mentor's readiness claim",
      report.overclaim
        ? 'During training the mentor said the student was ready. The locked test disagreed.'
        : 'During training the mentor said the student was ready, and the locked test agreed.',
    );
  }

  sections.push(
    '## How the test was run',
    test.ranOffline
      ? "The locked test was run once, on the student model's own runtime, with no network access and the mentor disconnected. The mentor never saw these tasks."
      : report.testedOn === 'hosted'
        ? 'The locked test was run once on a hosted copy of the student with the mentor disconnected, so it was not run offline. The mentor never saw these tasks.'
        : 'The locked test was run once with the mentor disconnected. It was not run offline.',
  );

  if (report.tasks !== undefined)
    sections.push('## Where the test tasks came from', taskSource(report));
  if (report.tasks?.rules !== undefined) {
    sections.push(
      '## The rule behind the expected answers',
      ruleDetails(report, report.tasks.rules),
    );
  }

  return `${sections.join('\n\n')}\n`;
}

/**
 * A rule in words: numbered steps, each with what the person said that it rests on, or the one
 * sentence for a report made before the steps existed.
 */
function ruleWords(rule: RuleReport): string {
  const { steps } = rule;
  if (steps === undefined || steps.length === 0) return `The rule in words: ${rule.statement}`;
  const lines = steps.map(
    (step, at) => `${at + 1}. ${step.text}${step.note === undefined ? '' : ` ${step.note}`}`,
  );
  return `The rule in words:\n${lines.join('\n')}`;
}

/**
 * The rules the expected answers were calculated by, in full: each in words with its version,
 * the passages it rests on, when the person confirmed it, how numbers and rounding were read,
 * which rows were left out, what each side of a condition did, and whether teaching ran.
 */
function ruleDetails(report: ReportCard, rules: readonly RuleReport[]): string {
  const teaching = teachingLine(report.cost.rounds);
  const parts = rules.map((rule) =>
    [
      `### ${rule.label} (version ${rule.version})`,
      ruleWords(rule),
      `The rule exactly as Architect evaluates it:\n\n\`\`\`json\n${JSON.stringify(rule.expression, null, 2)}\n\`\`\``,
      `The person confirmed this rule on ${rule.confirmedAt.slice(0, 10)}, over the records the tasks were made from.`,
      `It rests on these passages:\n${rule.passages.map((item) => `- ${passageOrigin(item)}: "${item.passage}"`).join('\n')}`,
      `How numbers, words and rounding were read:\n${rule.conventions.map((item) => `- ${item}`).join('\n')}`,
      `Rows of the table that could be worked out: ${count(rule.cases.eligible)} of ${count(rule.cases.total)}.${
        rule.excluded.length === 0
          ? ' None were left out.'
          : `\n${rule.excluded
              .map(
                (item) =>
                  `- ${count(item.count)} ${plural(item.count, 'row', 'rows')} left out because ${item.reason}${item.example === undefined ? '' : `, such as ${item.example}`}`,
              )
              .join('\n')}`
      }`,
      ...(rule.branches.length === 0
        ? []
        : [
            `Where each side of the rule applied:\n${rule.branches
              .map((item) => `- ${branchLine(item)}`)
              .join('\n')}`,
          ]),
      ...(rule.flags.length === 0
        ? []
        : [`Worth knowing:\n${rule.flags.map((item) => `- ${item}`).join('\n')}`]),
    ].join('\n\n'),
  );
  return [...parts, teaching].join('\n\n');
}

/**
 * Where the final test's requests came from, said plainly: tasks Architect made from a job
 * description the mentor drafted are checked against that description, which nobody has
 * certified as right for the business.
 */
function taskSource(report: ReportCard): string {
  const { tasks } = report;
  if (tasks === undefined) return '';
  if (tasks.source === 'attached') {
    return 'The final test is part of the example tasks that were attached to the job. Their expected answers are the ones the person who wrote them gave.';
  }
  const cost =
    tasks.draftingUsd !== undefined && tasks.draftingUsd > 0
      ? ` Drafting the job cost the mentor ${dollars(tasks.draftingUsd)}, before training.`
      : '';
  return [
    `The final test's requests were generated by Architect from the files that were attached, following a job description that the mentor (${report.mentor.label}) drafted. Architect worked out every expected answer from those files with its own code, and the mentor never saw the final test.`,
    `Answers are checked against that job description. They have not been independently certified as correct for the business.${cost}`,
  ].join('\n\n');
}
