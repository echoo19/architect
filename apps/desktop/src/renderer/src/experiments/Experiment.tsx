import { useState } from 'react';
import {
  capToFund,
  type ArmId,
  type ComparisonReport,
  type ExperimentDetail,
  type ExperimentInput,
  type ExperimentRecord,
  type ExperimentStart,
} from '@architect/shared';
import {
  Badge,
  Button,
  CapMeter,
  Card,
  CardRow,
  DataTable,
  DetailList,
  ErrorState,
  Meter,
} from '@architect/ui';
import {
  Ban,
  Clock,
  FlaskConical,
  GraduationCap,
  Lock,
  Pause,
  Play,
  Square,
  Wallet,
} from 'lucide-react';
import { experimentKeys, experimentsApi } from '../api/experiments';
import { fetchQuery } from '../api/query';
import { formatCost } from '../flow/format';
import { shortPath } from '../lib/format';
import { attempt } from '../lib/notify';
import { PlacePage } from '../shell/PlacePage';
import { ConfirmDialog } from './ConfirmDialog';
import { ArmTile } from './icons';
import {
  ARM_NAMES,
  DONE_TEACHING,
  SPARK_ARMS,
  STATUS_WORDS,
  STUDENT_ARMS,
  armStatusWord,
  minutesText,
  primaryResult,
  primaryText,
} from './model';
import { Results } from './Results';

/** One arm's state while the experiment runs: never a locked result. */
interface LiveArm {
  arm: ArmId;
  status: string;
  reason: string | null;
  rounds: { used: number; cap: number | null } | null;
  spark: { used: number | null; cap: number | null };
  student: { used: number | null; cap: number | null };
}

function liveArms(detail: ExperimentDetail): LiveArm[] {
  const { experiment, report } = detail;
  const reported = new Map((report?.arms ?? []).map((arm) => [arm.arm, arm]));
  return experiment.input.arms.map((asked) => {
    const arm = reported.get(asked.arm);
    if (arm === undefined) {
      return {
        arm: asked.arm,
        status: 'Not started',
        reason: null,
        rounds: null,
        spark: { used: null, cap: asked.sparkUsd ?? null },
        student: { used: null, cap: asked.studentUsd ?? null },
      };
    }
    return {
      arm: arm.arm,
      status: armStatusWord(arm, experiment.status),
      reason: arm.reason,
      rounds: arm.rounds === null ? null : { used: arm.rounds.used, cap: arm.caps.rounds },
      // An arm that never calls a model shows nothing for it, not a $0 of a $0 cap.
      spark: SPARK_ARMS.includes(arm.arm)
        ? { used: arm.spent.sparkUsd, cap: arm.caps.sparkUsd }
        : { used: null, cap: null },
      student: STUDENT_ARMS.includes(arm.arm)
        ? { used: arm.spent.studentUsd, cap: arm.caps.studentUsd }
        : { used: null, cap: null },
    };
  });
}

/** An amount against its cap, in figures over a thin meter; absent before anything was spent. */
function Spent({
  amount,
  tone,
}: {
  amount: { used: number | null; cap: number | null };
  tone: 'mentor' | 'student';
}) {
  if (amount.used === null) return null;
  const reading =
    amount.cap === null
      ? formatCost(amount.used)
      : `${formatCost(amount.used)} of ${formatCost(amount.cap)}`;
  return (
    <span className="ml-auto flex w-36 flex-col items-end gap-1.5">
      <span className={amount.cap !== null && amount.used > amount.cap ? 'text-danger' : undefined}>
        {reading}
      </span>
      {amount.cap !== null && (
        <Meter
          label={reading}
          tone={tone}
          value={amount.cap === 0 ? (amount.used > 0 ? 2 : 0) : amount.used / amount.cap}
        />
      )}
    </span>
  );
}

function ArmsTable({ detail }: { detail: ExperimentDetail }) {
  return (
    <DataTable
      aria-label="Arms"
      rows={liveArms(detail)}
      rowKey={(row) => row.arm}
      columns={[
        {
          key: 'arm',
          header: 'Arm',
          cell: (row) => (
            <span className="flex items-center gap-3">
              <ArmTile arm={row.arm} />
              {ARM_NAMES[row.arm]}
            </span>
          ),
        },
        {
          key: 'status',
          header: 'Status',
          width: '176px',
          cell: (row) => (
            <span className="flex items-center gap-2" title={row.reason ?? undefined}>
              {row.status === DONE_TEACHING && <Lock size={13} aria-hidden />}
              {row.status}
            </span>
          ),
        },
        {
          key: 'rounds',
          header: 'Rounds',
          align: 'end',
          width: '104px',
          cell: (row) =>
            row.rounds === null
              ? null
              : row.rounds.cap === null
                ? row.rounds.used
                : `${row.rounds.used} of ${row.rounds.cap}`,
        },
        {
          key: 'spark',
          header: 'Spark',
          align: 'end',
          width: '176px',
          cell: (row) => <Spent amount={row.spark} tone="mentor" />,
        },
        {
          key: 'student',
          header: 'Glimmer',
          align: 'end',
          width: '176px',
          cell: (row) => <Spent amount={row.student} tone="student" />,
        },
      ]}
    />
  );
}

/** Under a cent reads as nothing spent, so a fraction of a cent never looks over a $0 cap. */
const cents = (usd: number) => Math.round(usd * 100) / 100;

/**
 * The whole experiment's spend against its caps, and its wall clock. Compute with a $0 cap is
 * not used at all, so it stands alone with no meter and never reads as over.
 */
function SpendCard({ detail }: { detail: ExperimentDetail }) {
  const { experiment, report } = detail;
  const { caps } = experiment.input;
  // A cap the person raised before the release holds from then on.
  const studentCap = detail.amendments.at(-1)?.toUsd ?? caps.studentUsd;
  const student = report?.totals.studentUsd;
  const compute = cents(report?.totals.computeUsd ?? 0);
  return (
    <Card title="Spend">
      <div className="grid grid-cols-1 gap-x-10 gap-y-5 sm:grid-cols-2 xl:grid-cols-4">
        <CapMeter
          tone="mentor"
          label="Spark"
          used={report?.totals.sparkUsd ?? 0}
          cap={caps.sparkUsd}
          format={formatCost}
        />
        {student === null ? (
          <div className="flex items-baseline justify-between gap-3 text-ui">
            <span>Glimmer</span>
            <span title="Some attempt's price isn't known">Not known</span>
          </div>
        ) : (
          <CapMeter
            tone="student"
            label="Glimmer"
            used={student ?? 0}
            cap={studentCap}
            format={formatCost}
          />
        )}
        {caps.computeUsd === 0 && compute === 0 ? (
          <CapMeter label="Compute" used={0} format={() => 'Not used'} />
        ) : (
          <CapMeter label="Compute" used={compute} cap={caps.computeUsd} format={formatCost} />
        )}
        <CapMeter
          label="Time"
          used={experiment.runningMs / 60_000}
          cap={caps.wallMinutes}
          format={minutesText}
        />
      </div>
    </Card>
  );
}

/**
 * What it was run to find out, as frozen: the hypothesis and its primary comparison, and once the
 * tests are released what was measured for it. An experiment from before hypotheses has none.
 */
function HypothesisCard({
  input,
  report,
}: {
  input: ExperimentInput;
  report: ComparisonReport | null;
}) {
  const { hypothesis, primaryComparison } = input;
  if (hypothesis === undefined || primaryComparison === undefined) return null;
  const measured = report === null ? null : primaryResult(report, primaryComparison);
  return (
    <Card title="Hypothesis" icon={<FlaskConical size={16} strokeWidth={1.7} aria-hidden />}>
      <p className="m-0 max-w-[68ch] text-body text-pretty">{hypothesis}</p>
      <dl className="m-0 mt-4 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-ui">
        <dt className="font-medium">Primary comparison</dt>
        <dd className="m-0">{primaryText(input)}</dd>
        {measured !== null && (
          <>
            <dt className="font-medium">Measured</dt>
            <dd className="m-0 tabular-nums">{measured}</dd>
          </>
        )}
      </dl>
    </Card>
  );
}

/** What was frozen before it ran, for whoever needs to quote it. */
function PreregistrationCard({ experiment }: { experiment: ExperimentRecord }) {
  const { preregistration, input, job } = experiment;
  if (preregistration === null) return null;
  return (
    <Card title="Preregistration" icon={<Lock size={16} strokeWidth={1.7} aria-hidden />}>
      <DetailList
        items={[
          {
            label: 'Preregistered on',
            value: new Date(preregistration.at).toLocaleString('en-US'),
          },
          { label: 'Plan hash', value: preregistration.sha256 },
          {
            label: 'Field',
            value:
              input.jobDir === undefined
                ? `${job.name}, in your library`
                : `${job.name}, ${shortPath(input.jobDir)}`,
          },
          { label: 'Splits seed', value: job.splitsSeed },
          { label: 'Teaching seed', value: input.seeds.mentoring },
          { label: 'Final-test seeds', value: input.seeds.lockedTest.join(', ') },
          { label: 'Rounds', value: input.rounds },
        ]}
      />
    </Card>
  );
}

/** Spark's brief or a cut-down plan, waiting for the person before the run goes on. */
function WaitingCard({
  detail,
  onGoOn,
}: {
  detail: ExperimentDetail;
  onGoOn: (options: ExperimentStart) => Promise<boolean>;
}) {
  const [busy, setBusy] = useState(false);
  const { study, experiment } = detail;
  const go = async (options: ExperimentStart) => {
    setBusy(true);
    await onGoOn(options);
    setBusy(false);
  };
  if (study !== null && !study.confirmed) {
    const { brief } = study;
    return (
      <Card
        title="Spark's brief"
        icon={<GraduationCap size={16} strokeWidth={1.7} aria-hidden />}
        flush
        action={
          <Button
            variant="primary"
            size="sm"
            loading={busy}
            onClick={() => void go({ studyToken: study.token })}
          >
            Confirm and go on
          </Button>
        }
      >
        {brief.skills.map((skill) => (
          <CardRow key={skill.taskType} title={skill.label} detail={skill.text} />
        ))}
        {brief.questions.map((question) => (
          <CardRow key={question} title="Unclear" detail={question} />
        ))}
      </Card>
    );
  }
  return (
    <Card
      title="Waiting for you"
      action={
        <Button
          variant="primary"
          size="sm"
          loading={busy}
          onClick={() => void go({ confirm: true })}
        >
          Go on
        </Button>
      }
    >
      <p className="m-0 text-body text-pretty">{experiment.reason ?? 'It waits for you.'}</p>
    </Card>
  );
}

/**
 * An arm the Glimmer cap can't pay for at what an attempt has really cost: nothing is released
 * until the person raises the cap or drops the arm (decision 081).
 */
function FundingCard({
  detail,
  onAnswer,
}: {
  detail: ExperimentDetail;
  onAnswer: (options: ExperimentStart) => Promise<boolean>;
}) {
  const [asking, setAsking] = useState<'raise' | 'drop' | null>(null);
  const { funding, experiment } = detail;
  if (funding === null) return null;
  const arm = ARM_NAMES[funding.arm];
  const raised = capToFund(funding);
  const close = (open: boolean) => !open && setAsking(null);
  return (
    <>
      <Card
        title="Waiting for you"
        icon={<Wallet size={16} strokeWidth={1.7} aria-hidden />}
        action={
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => setAsking('drop')}>
              Drop the arm
            </Button>
            <Button variant="primary" size="sm" onClick={() => setAsking('raise')}>
              Raise the cap
            </Button>
          </div>
        }
      >
        <p className="m-0 text-body text-pretty">
          {experiment.reason ?? `${arm} needs more than the Glimmer cap has left.`}
        </p>
      </Card>
      <ConfirmDialog
        open={asking === 'raise'}
        onOpenChange={close}
        title={`Raise the Glimmer cap to ${formatCost(raised)}?`}
        confirm="Raise and go on"
        onConfirm={() => onAnswer({ studentCapUsd: raised })}
        lines={[
          {
            icon: <Wallet aria-hidden />,
            text: `From ${formatCost(funding.capUsd)}, enough for ${arm} at $${funding.priceUsd.toFixed(4)} an attempt.`,
          },
          {
            icon: <Lock aria-hidden />,
            text: 'The raise is kept with the experiment, and no final test has opened yet.',
          },
        ]}
      />
      <ConfirmDialog
        open={asking === 'drop'}
        onOpenChange={close}
        title={`Drop ${arm}?`}
        confirm="Drop and go on"
        tone="danger"
        onConfirm={() => onAnswer({ dropArms: [funding.arm] })}
        lines={[
          { icon: <Ban aria-hidden />, text: "It won't run, and the results say you dropped it." },
          {
            icon: <Lock aria-hidden />,
            text: 'The other arms go on, and their final tests open once they are done.',
          },
        ]}
      />
    </>
  );
}

/** A preregistered experiment: its live state, then its results once they are released. */
export function ExperimentView({ detail }: { detail: ExperimentDetail }) {
  const { experiment, report, released } = detail;
  const { id, status, input } = experiment;
  const [confirming, setConfirming] = useState<'start' | 'stop' | null>(null);
  const [acting, setActing] = useState(false);

  const act = async (title: string, run: () => Promise<unknown>) => {
    setActing(true);
    const done = await attempt(title, run);
    if (done !== undefined) {
      await fetchQuery(experimentKeys.detail(id), () => experimentsApi.get(id));
    }
    setActing(false);
    return done !== undefined;
  };

  const resume = (options: ExperimentStart) =>
    act("Couldn't go on", () => experimentsApi.resume(id, options));

  const action =
    status === 'preregistered' ? (
      <Button variant="primary" size="md" onClick={() => setConfirming('start')}>
        <Play size={16} aria-hidden />
        Start
      </Button>
    ) : status === 'running' ||
      status === 'paused' ||
      status === 'incomplete' ||
      status === 'waiting' ||
      status === 'needs_funding' ? (
      <div className="flex items-center gap-2">
        <Button size="md" variant="danger" disabled={acting} onClick={() => setConfirming('stop')}>
          <Square size={14} aria-hidden />
          Stop
        </Button>
        {status === 'running' ? (
          <Button
            size="md"
            loading={acting}
            onClick={() => void act("Couldn't pause it", () => experimentsApi.pause(id))}
          >
            <Pause size={16} aria-hidden />
            Pause
          </Button>
        ) : status !== 'waiting' && status !== 'needs_funding' ? (
          <Button variant="primary" size="md" loading={acting} onClick={() => void resume({})}>
            <Play size={16} aria-hidden />
            Resume
          </Button>
        ) : null}
      </div>
    ) : undefined;

  return (
    <PlacePage
      title={input.name}
      status={
        <span className="flex items-center gap-2">
          <Badge>{STATUS_WORDS[status]}</Badge>
          {report?.dryRun && <Badge>Simulation, no model called</Badge>}
        </span>
      }
      action={action}
    >
      <div className={released ? 'flex max-w-[960px] flex-col gap-10' : 'flex flex-col gap-4'}>
        <HypothesisCard input={input} report={released ? report : null} />
        {status === 'waiting' && <WaitingCard detail={detail} onGoOn={resume} />}
        {status === 'needs_funding' && <FundingCard detail={detail} onAnswer={resume} />}
        {status === 'failed' && (
          <ErrorState
            layout="inline"
            title="It stopped on an error"
            message={experiment.reason ?? 'The runner stopped without saying why.'}
          />
        )}
        {(status === 'paused' || status === 'stopped' || status === 'incomplete') &&
          experiment.reason && <p className="m-0 text-body">{experiment.reason}</p>}
        {released && report ? (
          <Results report={report} input={input} />
        ) : (
          <>
            <SpendCard detail={detail} />
            <ArmsTable detail={detail} />
            {status !== 'preregistered' && (
              <p className="m-0 px-1 text-ui">Results open here once every arm is done teaching.</p>
            )}
          </>
        )}
        <PreregistrationCard experiment={experiment} />
      </div>
      <ConfirmDialog
        open={confirming === 'start'}
        onOpenChange={(open) => !open && setConfirming(null)}
        title="Start this experiment?"
        confirm="Start"
        onConfirm={() => act("Couldn't start it", () => experimentsApi.start(id, {}))}
        lines={[
          {
            icon: <Wallet aria-hidden />,
            text: `It may spend up to ${formatCost(input.caps.sparkUsd)} of Spark, ${formatCost(input.caps.studentUsd)} of Glimmer and ${formatCost(input.caps.computeUsd)} of compute.`,
          },
          {
            icon: <Clock aria-hidden />,
            text: `It runs for ${minutesText(input.caps.wallMinutes)} at most. Closing Architect pauses it, and nothing goes on until you resume.`,
          },
          {
            icon: <GraduationCap aria-hidden />,
            text: 'If Spark studies the organizations first, its brief waits for you here.',
          },
        ]}
      />
      <ConfirmDialog
        open={confirming === 'stop'}
        onOpenChange={(open) => !open && setConfirming(null)}
        title="Stop it for good?"
        confirm="Stop"
        tone="danger"
        onConfirm={() => act("Couldn't stop it", () => experimentsApi.stop(id))}
        lines={[
          { icon: <Ban aria-hidden />, text: "It can't start again." },
          { icon: <Lock aria-hidden />, text: 'What it measured so far is kept.' },
        ]}
      />
    </PlacePage>
  );
}
