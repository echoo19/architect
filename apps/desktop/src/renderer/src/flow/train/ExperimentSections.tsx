import type { ReactNode } from 'react';
import type {
  Category,
  Experiment,
  Finding,
  Intervention,
  Job,
  ListedLesson,
  Measurement,
} from '@architect/shared';
import {
  cn,
  DetailList,
  Disclosure,
  DrawerSection,
  EvidenceMark,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@architect/ui';
import { ArrowRight, Check, ChevronRight, CircleMinus, CircleX } from 'lucide-react';
import { formatDuration } from '../../lib/format';
import { formatAnswerTime, formatCost } from '../format';
import { typeLabel } from '../names';
import {
  GATES,
  INTERVENTIONS,
  lessonOrigin,
  measurementLabel,
  orderedMeasurements,
  sentence,
} from './evidence-words';
import type { ModelNames } from './phase';

/** A finding's category by its id, as the job's vocabulary names it. */
function categoryLabel(categories: readonly Category[], id: string): string | null {
  return categories.find((category) => category.id === id)?.label ?? null;
}

/**
 * What Spark found in the round's failed practice attempts: the step it suspects, its evidence
 * and the category, each finding a way into the attempt at that step. Findings the runner set
 * aside show with the reason.
 */
export function Findings({
  intervention,
  job,
  categories,
  names,
  onOpenAttempt,
}: {
  intervention: Intervention;
  job: Job;
  categories: readonly Category[];
  names: ModelNames;
  onOpenAttempt: (finding: Finding) => void;
}) {
  if (intervention.findings.length === 0 && intervention.setAside.length === 0) return null;
  return (
    <DrawerSection
      title={intervention.findings.length === 1 ? 'Finding' : 'Findings'}
      tone="mentor"
    >
      <ul className="m-0 flex list-none flex-col gap-4 p-0">
        {intervention.findings.map((finding) => (
          <li key={`${finding.attemptId}-${finding.failureTurn}`} className="flex flex-col gap-2">
            <span className="flex flex-wrap items-baseline gap-x-2 text-sm text-fg-muted">
              <span>{typeLabel(job, finding.taskType)}</span>
              {categoryLabel(categories, finding.categoryId) && (
                <>
                  <span aria-hidden>·</span>
                  <span>{categoryLabel(categories, finding.categoryId)}</span>
                </>
              )}
            </span>
            <p className="m-0 text-md text-fg-soft text-pretty">{finding.cause}</p>
            <ul className="m-0 flex list-none flex-col gap-1 p-0 text-sm text-fg-secondary">
              {finding.evidence.map((item) => (
                <li key={`${item.turn}-${item.note}`} className="text-pretty">
                  <span className="tabular-nums text-fg-muted">Step {item.turn}</span> {item.note}
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => onOpenAttempt(finding)}
              className="group flex items-center gap-1.5 self-start rounded-xs text-sm text-fg-secondary transition-colors duration-150 hover:text-fg"
            >
              Open {names.student}&apos;s attempt at step {finding.failureTurn}
              <ArrowRight size={13} strokeWidth={2} aria-hidden />
            </button>
          </li>
        ))}
        {intervention.setAside.map((item) => (
          <li key={`${item.taskId}-${item.reason}`} className="flex items-start gap-2.5 text-sm">
            <CircleMinus size={14} aria-hidden className="mt-[3px] shrink-0 text-fg-faint" />
            <span className="text-fg-muted text-pretty">
              Set aside a finding on {item.taskId}: {item.reason}
            </span>
          </li>
        ))}
      </ul>
    </DrawerSection>
  );
}

/** The intervention Spark chose, by type with its icon, and its hypothesis in one sentence. */
export function InterventionLine({ intervention }: { intervention: Intervention }) {
  const { label, icon: Icon } = INTERVENTIONS[intervention.type];
  return (
    <div className="flex items-start gap-3 rounded-xl border border-line-card px-4 py-3">
      <Icon size={18} strokeWidth={1.7} aria-hidden className="mt-0.5 shrink-0 text-mentor" />
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="font-medium">{label}</span>
        {intervention.hypothesis && (
          <span className="text-fg-secondary text-pretty">{intervention.hypothesis}</span>
        )}
        {intervention.question && (
          <span className="text-fg-secondary text-pretty">{intervention.question}</span>
        )}
        {intervention.answer && (
          <span className="text-fg-secondary text-pretty">
            Your answer: {intervention.answer.text}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * The round's examples, each verified or rejected and how it was made, and what the teaching
 * plan set aside, with the reason: caps, and categories whose teaching stopped.
 */
export function RoundExamples({
  lessons,
  intervention,
  job,
  onOpen,
}: {
  lessons: readonly ListedLesson[];
  intervention: Intervention | undefined;
  job: Job;
  onOpen: (lesson: ListedLesson) => void;
}) {
  const skipped = intervention?.teaching?.skipped ?? [];
  if (lessons.length === 0 && skipped.length === 0) return null;
  return (
    <DrawerSection title="Examples">
      <ul className="m-0 flex list-none flex-col p-0">
        {lessons.map((lesson) => (
          <li key={lesson.id}>
            <button
              type="button"
              onClick={() => onOpen(lesson)}
              className="group grid min-h-12 w-full grid-cols-[18px_minmax(0,1fr)_auto_14px] items-center gap-x-3 border-t border-line-row py-2 text-left first:border-t-0"
            >
              {lesson.status === 'verified' ? (
                <Check
                  size={15}
                  strokeWidth={2.2}
                  role="img"
                  aria-label="Verified"
                  className="text-student"
                />
              ) : (
                <CircleX
                  size={15}
                  strokeWidth={1.8}
                  role="img"
                  aria-label="Rejected"
                  className="text-fg-faint"
                />
              )}
              <span className="flex min-w-0 flex-col">
                <span
                  className={cn(
                    'line-clamp-2 break-words',
                    lesson.status === 'verified' ? 'text-fg' : 'text-fg-muted',
                  )}
                >
                  {lesson.prompt ?? typeLabel(job, lesson.taskType)}
                </span>
                {lesson.status === 'rejected' && (
                  <span className="truncate text-sm text-fg-muted">{lesson.reason}</span>
                )}
              </span>
              <span className="text-sm text-fg-secondary">{lessonOrigin(lesson)}</span>
              <ChevronRight
                size={14}
                strokeWidth={1.8}
                aria-hidden
                className="text-fg-faint opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100"
              />
            </button>
          </li>
        ))}
        {skipped.map((item) => (
          <li
            key={`${item.what}-${item.reason}`}
            className="flex items-start gap-2.5 border-t border-line-row py-2.5 text-sm first:border-t-0"
          >
            <CircleMinus size={14} aria-hidden className="mt-[3px] shrink-0 text-fg-faint" />
            <span className="text-fg-muted text-pretty">
              Skipped {item.what}: {item.reason}
            </span>
          </li>
        ))}
      </ul>
    </DrawerSection>
  );
}

/** One cell of the check-task table: "6 of 9", with the failures under it. */
function ScoreCell({ pass, total }: { pass: number; total: number }) {
  return (
    <span className="flex flex-col items-end">
      <span className="font-mono tabular-nums text-fg">
        {pass} of {total}
      </span>
      {total > pass && <span className="text-xs text-fg-muted">{total - pass} failed</span>}
    </span>
  );
}

/**
 * The check tasks the change was measured on, per task type and in all, for each configuration
 * measured, with answer times and the types that lost passes.
 */
export function CheckTasks({
  experiment,
  job,
  names,
}: {
  experiment: Experiment;
  job: Job;
  names: ModelNames;
}) {
  const measured = orderedMeasurements(experiment);
  if (measured.length === 0) return null;
  const types = job.taskTypes.filter((type) =>
    measured.some((item) => item.perType.some((score) => score.type === type.id)),
  );
  const lost = new Map(experiment.regressions.map((item) => [item.type, item.before - item.after]));
  const runs = measured[0]?.seeds.length ?? 1;
  return (
    <DrawerSection
      title="Check tasks"
      actions={
        <EvidenceMark kind="check">
          {runs > 1 ? `${runs} runs, hidden from ${names.mentor}` : `Hidden from ${names.mentor}`}
        </EvidenceMark>
      }
    >
      <Table aria-label="Check tasks by type">
        <TableHeader>
          <TableRow>
            <TableHead>Task type</TableHead>
            {measured.map((item) => (
              <TableHead key={item.label} className="text-right">
                {measurementLabel(item)}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {types.map((type) => (
            <TableRow key={type.id}>
              <TableCell>
                <span className="flex flex-col">
                  <span>{type.label}</span>
                  {(lost.get(type.id) ?? 0) > 0 && (
                    <span className="text-xs text-danger">
                      Lost {lost.get(type.id)} {lost.get(type.id) === 1 ? 'pass' : 'passes'}
                    </span>
                  )}
                </span>
              </TableCell>
              {measured.map((item) => {
                const score = item.perType.find((entry) => entry.type === type.id);
                return (
                  <TableCell key={item.label} className="text-right align-top">
                    {score ? <ScoreCell pass={score.pass} total={score.total} /> : '–'}
                  </TableCell>
                );
              })}
            </TableRow>
          ))}
          <TableRow>
            <TableCell className="font-medium">In all</TableCell>
            {measured.map((item) => (
              <TableCell key={item.label} className="text-right align-top">
                <ScoreCell pass={item.score.pass} total={item.score.total} />
              </TableCell>
            ))}
          </TableRow>
          <TableRow>
            <TableCell>Answer time</TableCell>
            {measured.map((item) => (
              <TableCell key={item.label} className="text-right align-top">
                <span className="flex flex-col items-end">
                  <span className="font-mono tabular-nums text-fg">
                    {formatAnswerTime(item.latencyMs.p50)}
                  </span>
                  <span className="text-xs text-fg-muted">
                    95% within {formatAnswerTime(item.latencyMs.p95)}
                  </span>
                </span>
              </TableCell>
            ))}
          </TableRow>
        </TableBody>
      </Table>
    </DrawerSection>
  );
}

/** The hard gates every change must pass whatever it gained: writes, answer time, real weights. */
export function Gates({ experiment }: { experiment: Experiment }) {
  if (experiment.gates.length === 0) return null;
  return (
    <DrawerSection title="Gates">
      <ul className="m-0 flex list-none flex-col gap-2 p-0 text-sm">
        {experiment.gates.map((gate) => (
          <li key={gate.gate} className="flex items-start gap-2.5">
            {gate.passed ? (
              <Check
                size={14}
                strokeWidth={2.2}
                aria-hidden
                className="mt-[3px] shrink-0 text-student"
              />
            ) : (
              <CircleX
                size={14}
                strokeWidth={1.8}
                aria-hidden
                className="mt-[3px] shrink-0 text-danger"
              />
            )}
            <span className="min-w-0 text-pretty">
              <span className="text-fg">{GATES[gate.gate]}</span>{' '}
              <span className="text-fg-secondary">{sentence(gate.detail)}</span>
            </span>
          </li>
        ))}
      </ul>
    </DrawerSection>
  );
}

function Figure({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 bg-modal px-4 py-3">
      <dt className="text-sm text-fg-secondary">{label}</dt>
      <dd className="m-0 font-mono text-lg tabular-nums">{children}</dd>
    </div>
  );
}

/** What the round spent, line by line: Spark, compute, time, and attempts. */
export function RoundCost({ experiment, names }: { experiment: Experiment; names: ModelNames }) {
  const { budget } = experiment;
  return (
    <DrawerSection title="Cost">
      <dl className="m-0 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line-card bg-line-card sm:grid-cols-4">
        <Figure label={names.mentor}>{formatCost(budget.mentorUsd)}</Figure>
        <Figure label="Compute">
          {formatCost(budget.computeUsd)}
          {budget.computeMinutes > 0 && (
            <span className="text-sm text-fg-muted">
              {' '}
              · {Math.round(budget.computeMinutes)} min
            </span>
          )}
        </Figure>
        <Figure label="Time">{formatDuration(budget.minutes * 60_000)}</Figure>
        <Figure label="Attempts">{budget.attempts}</Figure>
      </dl>
    </DrawerSection>
  );
}

function seedsOf(measurements: readonly Measurement[]): string {
  const seeds = [...new Set(measurements.flatMap((item) => item.seeds))];
  return seeds.length > 0 ? seeds.join(', ') : 'none';
}

/** Ids, versions, seeds and where each measurement came from, folded away. */
export function ExperimentDetails({
  experiment,
  intervention,
}: {
  experiment: Experiment;
  intervention: Intervention | undefined;
}) {
  const { inputs } = experiment;
  return (
    <Disclosure label="Details">
      <DetailList
        items={[
          { label: 'Experiment', value: experiment.id },
          ...(intervention ? [{ label: 'Intervention', value: intervention.id }] : []),
          { label: 'Kind', value: experiment.kind },
          {
            label: 'Setup',
            value:
              inputs.candidateVersion === null
                ? `version ${inputs.baseVersion}`
                : `version ${inputs.baseVersion} to ${inputs.candidateVersion}`,
          },
          ...(inputs.candidateAdapter
            ? [
                {
                  label: 'Trained weights',
                  value: `${inputs.candidateAdapter.id} (${inputs.candidateAdapter.label}${inputs.candidateAdapter.standIn ? ', stand-in' : ''})`,
                },
              ]
            : []),
          ...(inputs.datasetSha256 ? [{ label: 'Dataset', value: inputs.datasetSha256 }] : []),
          ...(experiment.recipe
            ? [
                {
                  label: 'Recipe',
                  value: `${experiment.recipe.name} ${experiment.recipe.version} (${experiment.recipe.sha256})`,
                },
              ]
            : []),
          { label: 'Check seeds', value: seedsOf(experiment.measurements) },
          ...(experiment.seeds.train === null
            ? []
            : [{ label: 'Practice seed', value: String(experiment.seeds.train) }]),
          ...experiment.measurements.map((item) => ({
            label: measurementLabel(item),
            value: `${item.configuration.actor}, ${item.configuration.backend}, setup version ${item.configuration.harnessVersion}; ${item.provenance}`,
          })),
          { label: 'Tokens', value: tokensOf(experiment) },
          { label: 'Examples', value: inputs.lessonIds.join(', ') || 'none' },
        ]}
      />
    </Disclosure>
  );
}

function tokensOf(experiment: Experiment): string {
  const { budget } = experiment;
  const count = (n: number) => n.toLocaleString('en-US');
  return `mentor ${count(budget.mentorInputTokens)} in, ${count(budget.mentorOutputTokens)} out; student ${count(budget.studentInputTokens)} in, ${count(budget.studentOutputTokens)} out`;
}
