import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { ArmId, ExperimentDetail, ExperimentGroup, ExperimentInput } from '@architect/shared';
import {
  Badge,
  Button,
  CapMeter,
  Card,
  CardRow,
  ChoiceTiles,
  ErrorState,
  Input,
  Inspector,
  Select,
  Stat,
  Textarea,
  Tooltip,
  type InspectorTab,
} from '@architect/ui';
import {
  ClipboardCheck,
  FileLock2,
  FlaskConical,
  FolderOpen,
  GraduationCap,
  Hash,
  Library,
  Lock,
  Repeat2,
  User,
  Wallet,
} from 'lucide-react';
import { flowApi } from '../api/client';
import { useJobs } from '../api/hooks';
import { experimentKeys, experimentsApi } from '../api/experiments';
import { fetchQuery, setQueryData, toError } from '../api/query';
import { fileName, formatCost } from '../flow/format';
import { shortPath } from '../lib/format';
import { modelTabsFit } from '../lib/names';
import { attempt } from '../lib/notify';
import { navigate, paths } from '../lib/router';
import { PlacePage } from '../shell/PlacePage';
import { ConfirmDialog } from './ConfirmDialog';
import { ARM_ICONS, ArmTile } from './icons';
import {
  armDescriptions,
  armNames,
  ARMS,
  DEFAULT_NAMES,
  experimentNames,
  SPARK_ARMS,
  STATUS_WORDS,
  STUDENT_ARMS,
  WEIGHT_ARMS,
  GROUP_WORDS,
  defaultInput,
  inputProblem,
  preregisterProblem,
  minutesText,
  withArmCap,
  withArms,
} from './model';
import { NumberRow } from './NumberRow';
import type { ModelNames } from '../flow/train/phase';

type Tab = 'teacher' | 'student' | 'teaching' | 'evaluation' | 'budget';

const tabIcon = { size: 16, strokeWidth: 1.7, 'aria-hidden': true } as const;

/**
 * The inspector's tabs, the first two named after the models the experiment runs: by their icons
 * when the names are too long to sit beside the others uncut.
 */
function tabsFor(names: ModelNames): readonly InspectorTab<Tab>[] {
  const iconOnly = !modelTabsFit(names);
  return [
    { value: 'teacher', label: names.mentor, icon: <GraduationCap {...tabIcon} />, iconOnly },
    { value: 'student', label: names.student, icon: <User {...tabIcon} />, iconOnly },
    { value: 'teaching', label: 'Teaching', icon: <Repeat2 {...tabIcon} /> },
    { value: 'evaluation', label: 'Evaluation', icon: <ClipboardCheck {...tabIcon} /> },
    { value: 'budget', label: 'Budget', icon: <Wallet {...tabIcon} /> },
  ];
}

/** How long the plan waits for typing to stop before the engine projects it again. */
const REVISE_MS = 400;

/**
 * Designing an experiment: a new one until its field is chosen, from the library (`jobId`'s when
 * one is named) or a folder, then its draft.
 */
export function ExperimentDesign({
  detail,
  jobId,
}: {
  detail: ExperimentDetail | null;
  jobId?: string | undefined;
}) {
  const [input, setInput] = useState<ExperimentInput | null>(detail?.experiment.input ?? null);
  const [problem, setProblem] = useState<Error | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [confirming, setConfirming] = useState<'preregister' | 'calibrate' | null>(null);
  const pending = useRef<{ timer: ReturnType<typeof setTimeout>; send: () => Promise<void> }>(
    undefined,
  );
  const id = detail?.experiment.id;
  // The field's own models name every line once it is chosen (decision 093).
  const names = detail ? experimentNames(detail) : DEFAULT_NAMES;
  const arms = armNames(names);

  useEffect(() => () => clearTimeout(pending.current?.timer), []);

  const send = async (next: ExperimentInput) => {
    if (id === undefined) return;
    try {
      setQueryData(experimentKeys.detail(id), await experimentsApi.revise(id, next));
      setProblem(null);
    } catch (error) {
      setProblem(toError(error));
    }
  };

  const change = (next: ExperimentInput) => {
    setInput(next);
    clearTimeout(pending.current?.timer);
    pending.current = undefined;
    if (inputProblem(next) !== null) return;
    const sending = () => send(next);
    pending.current = { timer: setTimeout(() => void sending(), REVISE_MS), send: sending };
  };

  /** Sends a change still waiting on the timer, so what is frozen is what is on screen. */
  const flush = async () => {
    const waiting = pending.current;
    if (!waiting) return;
    clearTimeout(waiting.timer);
    pending.current = undefined;
    await waiting.send();
  };

  /** Plans a draft on the field chosen, named after its job, and opens it. */
  const planOn = async (source: { jobId: string } | { jobDir: string }, name: string) => {
    setChoosing(true);
    const planned = await attempt("Couldn't plan an experiment on that field", async () => {
      const first = await experimentsApi.plan(defaultInput(source, name));
      if (first.experiment.job.name === name) return first;
      return experimentsApi.revise(first.experiment.id, {
        ...first.experiment.input,
        name: first.experiment.job.name,
      });
    });
    setChoosing(false);
    if (!planned) return;
    setQueryData(experimentKeys.detail(planned.experiment.id), planned);
    navigate(paths.experiment(planned.experiment.id), { replace: true });
  };

  const chooseFolder = async () => {
    const [folder] =
      (await attempt("Couldn't open the folder", () =>
        flowApi.pickFiles({ title: "Choose the field's folder", directory: true }),
      )) ?? [];
    if (folder !== undefined) await planOn({ jobDir: folder }, fileName(folder));
  };

  const preregister = async () => {
    if (id === undefined) return false;
    await flush();
    const done = await attempt("Couldn't preregister it", () => experimentsApi.preregister(id));
    if (!done) return false;
    await fetchQuery(experimentKeys.detail(id), () => experimentsApi.get(id));
    return true;
  };

  const calibrate = async () => {
    if (id === undefined) return false;
    await flush();
    const done = await attempt("Couldn't start calibrating", () => experimentsApi.calibrate(id));
    if (!done) return false;
    await fetchQuery(experimentKeys.detail(id), () => experimentsApi.get(id));
    return true;
  };

  const blocked =
    input === null || detail === null
      ? null
      : (inputProblem(input) ?? preregisterProblem(input, detail.groups));
  const calibrating = detail?.experiment.status === 'calibrating';

  return (
    <PlacePage
      title={input?.name.trim() ? input.name : 'New experiment'}
      status={detail ? <Badge>{STATUS_WORDS[detail.experiment.status]}</Badge> : undefined}
      action={
        <div className="flex items-center gap-3">
          {blocked && detail && <span className="text-ui">{blocked}</span>}
          <Button
            variant="primary"
            size="md"
            disabled={!detail || blocked !== null || calibrating}
            onClick={() => setConfirming('preregister')}
          >
            <FileLock2 size={16} aria-hidden />
            Preregister
          </Button>
        </div>
      }
      aside={
        input && (
          <Inspector<Tab>
            aria-label="Experiment settings"
            tabs={tabsFor(names)}
            rememberAs="experiment"
          >
            {(tab) => (
              <Settings
                tab={tab}
                input={input}
                names={names}
                splitsSeed={detail?.experiment.job.splitsSeed ?? null}
                onChange={change}
              />
            )}
          </Inspector>
        )
      }
    >
      <div className="flex max-w-[880px] flex-col gap-4">
        {input && detail && (
          <HypothesisCard input={input} groups={detail.groups} arms={arms} onChange={change} />
        )}
        <FieldCard
          input={input}
          detail={detail}
          jobId={jobId}
          choosing={choosing}
          onLibrary={(job) => void planOn({ jobId: job.id }, job.name)}
          onFolder={() => void chooseFolder()}
          onName={(name) => input && change({ ...input, name })}
        />
        <Card title="Arms">
          <p className="m-0 mb-4 text-small">
            Arms are the setups compared, each taught and tested on the same tasks and seeds.
          </p>
          <ChoiceTiles<ArmId>
            multiple
            aria-label="Arms"
            columns={3}
            disabled={input === null}
            value={input?.arms.map((item) => item.arm) ?? []}
            onValueChange={(arms) => input && change(withArms(input, arms))}
            options={ARMS.map((arm) => ({
              value: arm,
              label: arms[arm],
              description: armDescriptions(names)[arm],
              icon: ARM_ICONS[arm],
              disabled: WEIGHT_ARMS.has(arm),
            }))}
          />
          <p className="m-0 mt-4 flex items-center gap-2 text-small">
            <Lock size={13} aria-hidden />
            Adapters train and test on this computer&apos;s GPU, which experiments never use.
          </p>
        </Card>
        {input && detail && <PlanCard input={input} />}
        {problem && (
          <ErrorState
            layout="inline"
            title="Couldn't update the estimate"
            message={problem.message}
            onRetry={() => input && void send(input)}
          />
        )}
        {input && detail && (
          <EstimateCard
            input={input}
            detail={detail}
            names={names}
            onCalibrate={() => setConfirming('calibrate')}
          />
        )}
      </div>
      {detail && input && (
        <>
          <ConfirmDialog
            open={confirming === 'preregister'}
            onOpenChange={(open) => !open && setConfirming(null)}
            title="Preregister this experiment?"
            confirm="Preregister"
            onConfirm={preregister}
            lines={[
              {
                icon: <FileLock2 aria-hidden />,
                text: `Its hypothesis, its primary comparison, its ${input.arms.length} arms, seeds, ${input.rounds} rounds and caps are frozen. Nothing in the plan can change afterwards.`,
              },
              {
                icon: <Hash aria-hidden />,
                text: "The plan and the field's files are stored with their hash and the time. If the files change, it won't start.",
              },
              {
                icon: <Wallet aria-hidden />,
                text: 'Nothing is spent until you start it.',
              },
            ]}
          />
          <ConfirmDialog
            open={confirming === 'calibrate'}
            onOpenChange={(open) => !open && setConfirming(null)}
            title="Calibrate the estimate?"
            confirm="Calibrate"
            onConfirm={calibrate}
            lines={calibrationLines(detail, names)}
          />
        </>
      )}
    </PlacePage>
  );
}

function calibrationLines(detail: ExperimentDetail, { mentor, student }: ModelNames) {
  const { calibration } = detail;
  return [
    {
      icon: <User aria-hidden />,
      text: `${student} alone answers ${calibration.tasks} calibration tasks, about ${formatCost(calibration.studentUsdEstimate)}, and never more than ${formatCost(calibration.studentUsdCap)}.`,
    },
    ...(calibration.studySparkUsdCap === null
      ? []
      : [
          {
            icon: <GraduationCap aria-hidden />,
            text: `${mentor} studies the organizations it is taught on, for at most ${formatCost(calibration.studySparkUsdCap)}.`,
          },
        ]),
    {
      icon: <Wallet aria-hidden />,
      text: 'The estimate then uses the measured price of an attempt.',
    },
  ];
}

const rowIcon = (icon: ReactNode) => (
  <span className="flex size-9 items-center justify-center rounded-control bg-selected">
    {icon}
  </span>
);

/**
 * What the experiment is run to find out, first: the hypothesis in the person's words, and the
 * one comparison it is about, arm A's pass rate less arm B's on a part of the final test.
 */
function HypothesisCard({
  input,
  groups,
  arms,
  onChange,
}: {
  input: ExperimentInput;
  groups: readonly ExperimentGroup[];
  arms: Record<ArmId, string>;
  onChange: (next: ExperimentInput) => void;
}) {
  const chosen = input.arms.map((item) => item.arm);
  const primary = input.primaryComparison;
  const armOptions = (other: ArmId | undefined) =>
    chosen.map((arm) => ({ value: arm, label: arms[arm], disabled: arm === other }));
  /** One side chosen: the other side kept where it can be, else the bare student or another arm. */
  const compare = (side: 'a' | 'b', arm: ArmId) => {
    const kept = side === 'a' ? primary?.b : primary?.a;
    const other =
      kept !== undefined && kept !== arm
        ? kept
        : (chosen.find((item) => item !== arm && item === 'bare') ??
          chosen.find((item) => item !== arm));
    if (other === undefined) return;
    const group = primary?.group ?? 'all';
    onChange({
      ...input,
      primaryComparison: side === 'a' ? { a: arm, b: other, group } : { a: other, b: arm, group },
    });
  };
  return (
    <Card title="Hypothesis" icon={<FlaskConical size={16} strokeWidth={1.7} aria-hidden />}>
      <Textarea
        aria-label="Hypothesis"
        rows={3}
        maxLength={2000}
        placeholder="What you expect to find, and why"
        value={input.hypothesis ?? ''}
        onChange={(event) => onChange({ ...input, hypothesis: event.target.value })}
      />
      <h3 className="m-0 mb-2 mt-5 text-ui font-medium">Primary comparison</h3>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-ui">
        <Select<ArmId>
          aria-label="Arm A"
          placeholder="Arm"
          value={primary?.a}
          options={armOptions(primary?.b)}
          onValueChange={(arm) => compare('a', arm)}
        />
        <span className="flex items-center gap-3">
          minus
          <Select<ArmId>
            aria-label="Arm B"
            placeholder="Arm"
            value={primary?.b}
            options={armOptions(primary?.a)}
            onValueChange={(arm) => compare('b', arm)}
          />
        </span>
        <span className="flex items-center gap-3">
          on
          <Select<ExperimentGroup>
            aria-label="Part of the final test"
            placeholder="Part of the test"
            disabled={primary === undefined}
            value={primary?.group}
            options={groups.map((group) => ({ value: group, label: GROUP_WORDS[group] }))}
            onValueChange={(group) =>
              primary && onChange({ ...input, primaryComparison: { ...primary, group } })
            }
          />
        </span>
      </div>
    </Card>
  );
}

/**
 * The field it runs on: before one is chosen, a field of the library (the one named, else the
 * first) or, for a job that isn't in it, a folder; then the field chosen, and the name.
 */
function FieldCard({
  input,
  detail,
  jobId,
  choosing,
  onLibrary,
  onFolder,
  onName,
}: {
  input: ExperimentInput | null;
  detail: ExperimentDetail | null;
  jobId: string | undefined;
  choosing: boolean;
  onLibrary: (job: { id: string; name: string }) => void;
  onFolder: () => void;
  onName: (name: string) => void;
}) {
  const jobs = useJobs();
  // Only a job with tasks has a sealed final test to compare on.
  const fields = (jobs.data ?? []).filter((job) => job.taskCount > 0);
  const [picked, setPicked] = useState<string | undefined>(jobId);
  const field = fields.find((job) => job.id === picked) ?? fields[0];
  if (input === null || detail === null) {
    return (
      <Card title="Field" flush>
        <CardRow
          icon={rowIcon(<Library size={16} strokeWidth={1.7} aria-hidden />)}
          title="A field in your library"
          detail={
            jobs.status === 'error'
              ? "Your fields couldn't be read"
              : jobs.data && fields.length === 0
                ? 'No field has tasks yet'
                : 'Its tasks, its organizations and its final test'
          }
          end={
            <div className="flex items-center gap-2">
              <Select<string>
                aria-label="Field"
                placeholder="Choose a field"
                disabled={fields.length === 0}
                value={field?.id}
                options={fields.map((job) => ({ value: job.id, label: job.name }))}
                onValueChange={setPicked}
              />
              <Button
                variant="primary"
                size="sm"
                disabled={field === undefined}
                loading={choosing}
                onClick={() => field && onLibrary(field)}
              >
                Use field
              </Button>
            </div>
          }
        />
        <CardRow
          icon={rowIcon(<FolderOpen size={16} strokeWidth={1.7} aria-hidden />)}
          title="A job folder"
          detail="For a job not in the library: its job.json, tasks and each organization's files"
          end={
            <Button size="sm" disabled={choosing} onClick={onFolder}>
              Choose folder
            </Button>
          }
        />
      </Card>
    );
  }
  const splits = ` · splits seed ${detail.experiment.job.splitsSeed}`;
  return (
    <Card title="Field" flush>
      <CardRow
        icon={rowIcon(
          input.jobDir === undefined ? (
            <Library size={16} strokeWidth={1.7} aria-hidden />
          ) : (
            <FolderOpen size={16} strokeWidth={1.7} aria-hidden />
          ),
        )}
        title={detail.experiment.job.name}
        detail={
          input.jobDir === undefined ? (
            `In your library${splits}`
          ) : (
            <>
              <span className="font-mono">{shortPath(input.jobDir)}</span>
              {splits}
            </>
          )
        }
      />
      <div className="flex items-center gap-4 border-t border-line px-6 py-3">
        <label htmlFor="experiment-name" className="w-24 shrink-0 text-ui font-medium">
          Name
        </label>
        <Input
          id="experiment-name"
          value={input.name}
          maxLength={120}
          onChange={(event) => onName(event.target.value)}
        />
      </div>
    </Card>
  );
}

/** The seeds and rounds the plan holds, as figures; the inspector changes them. */
function PlanCard({ input }: { input: ExperimentInput }) {
  const [first, ...repeats] = input.seeds.lockedTest;
  return (
    <Card title="Seeds and rounds">
      <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
        <Stat value={input.seeds.mentoring} label="Teaching seed" />
        <Stat value={first ?? '–'} label="Final-test seed" />
        <Stat value={repeats.length} label={repeats.length === 1 ? 'Repeat' : 'Repeats'} />
        <Stat value={input.rounds} label="Rounds at most" />
      </div>
    </Card>
  );
}

/**
 * What the plan is expected to spend, before anything does: each total against its cap, then
 * each arm. From calibration's measured price once it ran, at the assumed price before.
 */
function EstimateCard({
  input,
  detail,
  names,
  onCalibrate,
}: {
  input: ExperimentInput;
  detail: ExperimentDetail;
  names: ModelNames;
  onCalibrate: () => void;
}) {
  const { projection, calibration, experiment } = detail;
  const measured = projection.inputs.every((item) => item.source === 'measured');
  const chosen = new Set(input.arms.map((item) => item.arm));
  const arms = projection.arms.filter((arm) => chosen.has(arm.arm));
  const own = new Map(input.arms.map((item) => [item.arm, item]));
  // The chosen arms that fit their budgets, added up, as the runner's funded totals are.
  const funded = (key: 'sparkUsd' | 'studentUsd' | 'computeUsd' | 'wallMinutes') =>
    arms.filter((arm) => arm.funded).reduce((sum, arm) => sum + arm[key], 0);
  return (
    <Card
      title="Estimate"
      flush
      action={<Badge>{measured ? 'Measured prices' : 'Assumed prices'}</Badge>}
    >
      <div className="grid grid-cols-1 gap-x-10 gap-y-5 px-6 pb-6 pt-1 sm:grid-cols-2">
        <CapMeter
          tone="mentor"
          label={names.mentor}
          used={funded('sparkUsd')}
          cap={input.caps.sparkUsd}
          format={formatCost}
        />
        <CapMeter
          tone="student"
          label={names.student}
          used={funded('studentUsd') + projection.committedUsd}
          cap={input.caps.studentUsd}
          format={formatCost}
        />
        {input.caps.computeUsd === 0 ? (
          <CapMeter label="Compute" used={0} format={() => 'Not used'} />
        ) : (
          <CapMeter
            label="Compute"
            used={funded('computeUsd')}
            cap={input.caps.computeUsd}
            format={formatCost}
          />
        )}
        <CapMeter
          label="Time"
          used={funded('wallMinutes')}
          cap={input.caps.wallMinutes}
          format={minutesText}
        />
      </div>
      {arms.map((arm) => {
        const caps = own.get(arm.arm);
        const parts = [
          `${names.mentor} ${formatCost(arm.sparkUsd)}${caps?.sparkUsd === undefined ? '' : ` of ${formatCost(caps.sparkUsd)}`}`,
          `${names.student} ${formatCost(arm.studentUsd)}${caps?.studentUsd === undefined ? '' : ` of ${formatCost(caps.studentUsd)}`}`,
          minutesText(arm.wallMinutes),
        ];
        return (
          <CardRow
            key={arm.arm}
            icon={<ArmTile arm={arm.arm} />}
            title={armNames(names)[arm.arm]}
            detail={parts.join(' · ')}
            end={
              arm.funded ? undefined : (
                <Tooltip content={arm.reason ?? 'Not funded'}>
                  <span tabIndex={0} className="rounded-mark text-danger">
                    Not funded
                  </span>
                </Tooltip>
              )
            }
          />
        );
      })}
      <CardRow
        icon={
          <span className="flex size-9 items-center justify-center rounded-control bg-selected">
            <ClipboardCheck size={16} strokeWidth={1.7} aria-hidden />
          </span>
        }
        title="Calibration"
        detail={`${calibration.tasks} tasks, about ${formatCost(calibration.studentUsdEstimate)} of ${names.student}${
          calibration.studySparkUsdCap === null
            ? ''
            : `, ${names.mentor}'s study at most ${formatCost(calibration.studySparkUsdCap)}`
        }`}
        end={
          experiment.calibratedAt !== null ? (
            'Measured'
          ) : (
            <Button size="sm" loading={experiment.status === 'calibrating'} onClick={onCalibrate}>
              Calibrate
            </Button>
          )
        }
      />
    </Card>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col pb-5">
      <h3 className="m-0 pb-1 text-small font-medium">{title}</h3>
      {children}
    </section>
  );
}

/** The inspector's tabs: every number of the plan the engine takes, and nothing else. */
function Settings({
  tab,
  input,
  names,
  splitsSeed,
  onChange,
}: {
  tab: Tab;
  input: ExperimentInput;
  names: ModelNames;
  splitsSeed: number | null;
  onChange: (next: ExperimentInput) => void;
}) {
  const chosen = input.arms.map((item) => item.arm);
  const capRows = (arms: readonly ArmId[], kind: 'sparkUsd' | 'studentUsd') => {
    const shown = arms.filter((arm) => chosen.includes(arm));
    if (shown.length === 0) {
      return <p className="m-0 py-2 text-ui">No arm chosen spends here.</p>;
    }
    return shown.map((arm) => (
      <NumberRow
        key={`${kind}-${arm}`}
        label={armNames(names)[arm]}
        value={input.arms.find((item) => item.arm === arm)?.[kind]}
        optional
        placeholder="Default"
        unit="USD"
        onChange={(value) => onChange(withArmCap(input, arm, kind, value))}
      />
    ));
  };

  switch (tab) {
    case 'teacher':
      return (
        <Section title={`${names.mentor}'s cap for each arm`}>
          {capRows(SPARK_ARMS, 'sparkUsd')}
        </Section>
      );
    case 'student':
      return (
        <Section title={`${names.student}'s cap for each arm`}>
          {capRows(STUDENT_ARMS, 'studentUsd')}
        </Section>
      );
    case 'teaching':
      return (
        <Section title="Teaching">
          <NumberRow
            label="Rounds, at most"
            value={input.rounds}
            integer
            min={1}
            max={10}
            unit="Rounds"
            onChange={(rounds) => rounds !== undefined && onChange({ ...input, rounds })}
          />
          <NumberRow
            label="Teaching seed"
            value={input.seeds.mentoring}
            integer
            unit="Seed"
            onChange={(mentoring) =>
              mentoring !== undefined &&
              onChange({ ...input, seeds: { ...input.seeds, mentoring } })
            }
          />
        </Section>
      );
    case 'evaluation':
      return (
        <Section title="Final test">
          <div className="flex min-h-11 items-center gap-3 text-ui">
            <span className="min-w-0 flex-1 font-medium">Splits seed</span>
            <span className="flex items-center gap-2 tabular-nums">
              <Lock size={13} aria-hidden />
              {splitsSeed ?? '–'}
            </span>
          </div>
          <SeedList
            seeds={input.seeds.lockedTest}
            onChange={(lockedTest) => onChange({ ...input, seeds: { ...input.seeds, lockedTest } })}
          />
        </Section>
      );
    case 'budget':
      return (
        <Section title="Caps for the whole experiment">
          <NumberRow
            label={names.mentor}
            value={input.caps.sparkUsd}
            unit="USD"
            onChange={(sparkUsd) =>
              sparkUsd !== undefined && onChange({ ...input, caps: { ...input.caps, sparkUsd } })
            }
          />
          <NumberRow
            label={names.student}
            value={input.caps.studentUsd}
            unit="USD"
            onChange={(studentUsd) =>
              studentUsd !== undefined &&
              onChange({ ...input, caps: { ...input.caps, studentUsd } })
            }
          />
          <NumberRow
            label="Compute"
            value={input.caps.computeUsd}
            unit="USD"
            onChange={(computeUsd) =>
              computeUsd !== undefined &&
              onChange({ ...input, caps: { ...input.caps, computeUsd } })
            }
          />
          <NumberRow
            label="Wall clock"
            value={input.caps.wallMinutes / 60}
            min={0.1}
            unit="Hours"
            onChange={(hours) =>
              hours !== undefined &&
              onChange({
                ...input,
                caps: { ...input.caps, wallMinutes: Math.round(hours * 60) },
              })
            }
          />
        </Section>
      );
  }
}

/** The final test's seeds: the first for every arm, each further one a repeat. */
function SeedList({
  seeds,
  onChange,
}: {
  seeds: readonly number[];
  onChange: (next: number[]) => void;
}) {
  const [text, setText] = useState(seeds.join(', '));
  const parts = text.split(/[\s,]+/).filter(Boolean);
  const numbers = parts.map(Number);
  const valid = parts.length > 0 && numbers.every((seed) => Number.isInteger(seed));
  return (
    <div className="flex flex-col gap-2 pt-2">
      <label htmlFor="final-test-seeds" className="text-ui font-medium">
        Seeds
      </label>
      <Input
        id="final-test-seeds"
        className="tabular-nums"
        aria-invalid={!valid || undefined}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          const next = event.target.value
            .split(/[\s,]+/)
            .filter(Boolean)
            .map(Number);
          if (next.length > 0 && next.every((seed) => Number.isInteger(seed))) onChange(next);
        }}
      />
      <span className="text-small">
        The first for every arm{numbers.length > 1 ? `, ${numbers.length - 1} more as repeats` : ''}
      </span>
    </div>
  );
}
