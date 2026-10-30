import { useState, type ReactNode } from 'react';
import type { GraduateSummary, Improvement, TeachingOverview } from '@architect/shared';
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  SettingsRow,
  SettingsSection,
  Skeleton,
  Spinner,
} from '@architect/ui';
import {
  Coins,
  Flag,
  GraduationCap,
  Hourglass,
  Laptop,
  Layers,
  MessageSquare,
  MessageSquarePlus,
  Square,
  TrendingUp,
} from 'lucide-react';
import { useVersions } from '../../api/graduates';
import {
  refreshTeaching,
  teachApi,
  useCorrections,
  useFreshTeaching,
  useImprovements,
  useTeachingOverview,
  useTeachingUpdates,
} from '../../api/teaching';
import { ProblemState } from '../../components/ProblemState';
import { errorOf } from '../../components/QueryValue';
import { formatPercent } from '../../lib/format';
import { shortModelName } from '../../lib/names';
import { attempt } from '../../lib/notify';
import { navigate, paths } from '../../lib/router';
import { useAgentSettingsUi } from '../settings/agentSettingsUi';
import { Change } from '../settings/MoveDialog';
import { createChat } from '../store';
import { FlaggedAnswers } from './FlaggedAnswers';
import { budgetLine, capsLine, flaggedSummary, lessonCount, runningImprovement } from './lessons';
import { StopImprovementDialog } from './StopImprovement';

/** An icon in a small tile, at the start of a row. */
function Tile({ children }: { children: ReactNode }) {
  return (
    <span className="flex size-7 items-center justify-center rounded-control bg-hover text-fg">
      {children}
    </span>
  );
}

const icon = { size: 15, strokeWidth: 1.7, 'aria-hidden': true } as const;

/**
 * What the agent is being taught, above its versions: the answers flagged for teaching, a way
 * to teach it something new, and Improve agent with the budget it keeps to. An agent from
 * another computer says why it can't be taught here instead.
 */
export function LessonsSection({ agent }: { agent: GraduateSummary }) {
  const overview = useTeachingOverview(agent.id);
  const improvements = useImprovements(agent.id);
  useFreshTeaching(agent.id);
  useTeachingUpdates(
    agent.id,
    (improvements.data ?? []).map((improvement) => improvement.runId),
  );

  let rows: ReactNode;
  if (overview.data?.unavailable) {
    rows = (
      <SettingsRow
        icon={
          <Tile>
            <Laptop {...icon} />
          </Tile>
        }
        label="Can't be taught on this computer"
        meta={overview.data.unavailable.message}
      />
    );
  } else if (overview.data) {
    rows = <TeachingRows agent={agent} overview={overview.data} />;
  } else if (overview.status === 'error') {
    rows = (
      <ProblemState
        layout="inline"
        error={overview.error}
        title="Couldn't load its lessons"
        onRetry={overview.reload}
        className="border-t border-line py-4"
      />
    );
  } else {
    rows = <RowsSkeleton />;
  }
  return <SettingsSection title="Lessons">{rows}</SettingsSection>;
}

function TeachingRows({ agent, overview }: { agent: GraduateSummary; overview: TeachingOverview }) {
  const corrections = useCorrections(agent.id);
  const improvements = useImprovements(agent.id);
  const closeSettings = useAgentSettingsUi((state) => state.close);
  const [reviewing, setReviewing] = useState(false);
  const [creating, setCreating] = useState(false);
  const summary = flaggedSummary(corrections.data ?? []);
  const flagged = (corrections.data ?? []).some((item) => item.status !== 'discarded');

  const startChat = async () => {
    setCreating(true);
    const chat = await attempt(`Couldn't start a chat with ${agent.name}`, () =>
      createChat(agent.id),
    );
    setCreating(false);
    if (!chat) return;
    closeSettings();
    navigate(paths.chat(agent.id, chat.id));
  };

  return (
    <>
      <SettingsRow
        icon={
          <Tile>
            <Flag {...icon} />
          </Tile>
        }
        label="Flagged answers"
        meta={corrections.data ? (summary ?? 'None yet') : undefined}
        error={errorOf(corrections)}
      >
        {flagged && (
          <Button size="xs" onClick={() => setReviewing(true)}>
            Review
          </Button>
        )}
      </SettingsRow>
      <SettingsRow
        icon={
          <Tile>
            <MessageSquarePlus {...icon} />
          </Tile>
        }
        label="Teach it something new"
        meta="Ask it in a new chat, then flag its answer"
      >
        <Button size="xs" loading={creating} onClick={() => void startChat()}>
          New chat
        </Button>
      </SettingsRow>
      <ImproveRow
        agent={agent}
        overview={overview}
        queued={(corrections.data ?? []).filter((item) => item.status === 'queued').length}
        improvements={improvements.data ?? []}
      />
      <FlaggedAnswers agent={agent} open={reviewing} onClose={() => setReviewing(false)} />
    </>
  );
}

/** The newest improvement's candidate, while it waits to be promoted. */
function waitingCandidate(improvements: readonly Improvement[]): Improvement | null {
  const newest = improvements[0];
  return newest?.candidateVersion !== undefined && newest.promotion.allowed ? newest : null;
}

/** "85% → 95% on check tasks", from the improvement's own measurements. */
function devChange(improvement: Improvement): string | null {
  const { before, after } = improvement.dev;
  if (!before || !after) return null;
  return `${formatPercent(before)} → ${formatPercent(after)} on check tasks`;
}

const RUNNING_LABELS: Partial<Record<Improvement['status'], string>> = {
  queued: 'Waiting for the student',
  paused: 'Paused',
  stopping: 'Stopping',
  testing: 'Writing its new version',
};

/**
 * Improve agent: with lessons queued, what it would spend; while it runs, where it is, with a
 * way to watch it and to stop it; once it has made a version, what changed.
 */
function ImproveRow({
  agent,
  overview,
  queued,
  improvements,
}: {
  agent: GraduateSummary;
  overview: TeachingOverview;
  queued: number;
  improvements: Improvement[];
}) {
  const closeSettings = useAgentSettingsUi((state) => state.close);
  const [confirming, setConfirming] = useState(false);
  const [stopping, setStopping] = useState(false);
  const running = runningImprovement(improvements);
  const made = running ? null : waitingCandidate(improvements);
  const mentor = shortModelName(overview.mentor ?? 'Spark');
  const go = (path: string) => {
    closeSettings();
    navigate(path);
  };

  let meta: string | undefined;
  let action: ReactNode = null;
  if (running) {
    meta = RUNNING_LABELS[running.status] ?? `Improving from version ${running.fromVersion}`;
    action = (
      <div className="flex items-center gap-2">
        {running.status !== 'paused' && <Spinner tone="mentor" size={14} label="Improving" />}
        <Button size="xs" onClick={() => go(paths.train(running.runId))}>
          Open
        </Button>
        <Button size="xs" onClick={() => setStopping(true)}>
          <Square size={11} fill="currentColor" strokeWidth={0} aria-hidden />
          Stop
        </Button>
      </div>
    );
  } else if (made) {
    meta = [`Made version ${made.candidateVersion}`, devChange(made)].filter(Boolean).join(' · ');
    action = (
      <Button size="xs" onClick={() => go(paths.improvement(made.runId))}>
        See what changed
      </Button>
    );
  } else if (queued === 0) {
    // Nothing to improve from yet: the flagged answers row above says so.
  } else if (overview.improve) {
    const waits = overview.improve.waits ? ' · waits for the run using it' : '';
    meta = `${lessonCount(queued)} saved · ${budgetLine(overview.improve.budget)}${waits}`;
    action = (
      <Button size="xs" onClick={() => setConfirming(true)}>
        Improve
      </Button>
    );
  } else {
    meta = `${lessonCount(queued)} saved · no version of it can run here to improve`;
  }

  return (
    <>
      <SettingsRow
        icon={
          <Tile>
            <TrendingUp {...icon} />
          </Tile>
        }
        label="Improve"
        meta={meta}
      >
        {action}
      </SettingsRow>
      {confirming && overview.improve && (
        <ImproveDialog
          agent={agent}
          improve={overview.improve}
          mentor={mentor}
          queued={queued}
          onClose={() => setConfirming(false)}
        />
      )}
      {running && (
        <StopImprovementDialog
          open={stopping}
          runId={running.runId}
          writing={running.status === 'testing'}
          kept={null}
          onClose={() => setStopping(false)}
        />
      )}
    </>
  );
}

/**
 * Asks before Improve agent starts, and says what it does: a new version from the active one,
 * scored on the check tasks, while the active one keeps answering; the budget it keeps to; and
 * whether it waits for another run first.
 */
function ImproveDialog({
  agent,
  improve,
  mentor,
  queued,
  onClose,
}: {
  agent: GraduateSummary;
  improve: NonNullable<TeachingOverview['improve']>;
  mentor: string;
  queued: number;
  onClose: () => void;
}) {
  const closeSettings = useAgentSettingsUi((state) => state.close);
  const versions = useVersions(agent.id);
  const [starting, setStarting] = useState(false);
  const from = improve.fromVersion;
  const next = versions.data
    ? Math.max(0, ...versions.data.map((version) => version.version)) + 1
    : null;
  const student = shortModelName(agent.manifest.student.label);

  const start = async () => {
    setStarting(true);
    const started = await attempt(`Couldn't start improving ${agent.name}`, async () => {
      const result = await teachApi.improve(agent.id, {
        maxRounds: improve.budget.maxRounds,
        maxMentorUsd: improve.budget.maxMentorUsd,
      });
      await refreshTeaching(agent.id);
      return result;
    });
    setStarting(false);
    if (!started) return;
    onClose();
    closeSettings();
    navigate(paths.train(started.runId));
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent title={`Improve ${agent.name}?`}>
        <ul className="m-0 flex list-none flex-col gap-3 px-7 pt-4">
          <Change icon={<GraduationCap size={15} strokeWidth={1.8} aria-hidden />}>
            Teaches {lessonCount(queued)} to a copy of version {from}.
          </Change>
          <Change icon={<Layers size={15} strokeWidth={1.8} aria-hidden />}>
            Saves version {next ?? from + 1} only if it scores better on the check tasks.
          </Change>
          <Change icon={<MessageSquare size={15} strokeWidth={1.8} aria-hidden />}>
            Version {from} keeps answering meanwhile.
          </Change>
          <Change icon={<Coins size={15} strokeWidth={1.8} aria-hidden />}>
            {capsLine(improve.budget, mentor)}
          </Change>
          {improve.waits && (
            <Change icon={<Hourglass size={15} strokeWidth={1.8} aria-hidden />}>
              Another run is using {student}, so this waits for it and starts on its own.
            </Change>
          )}
        </ul>
        <DialogFooter>
          <DialogClose asChild>
            <Button size="md">Cancel</Button>
          </DialogClose>
          <Button variant="primary" size="md" loading={starting} onClick={() => void start()}>
            Start improving
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RowsSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading what it is being taught" className="flex flex-col">
      {[0, 1, 2].map((row) => (
        <div key={row} className="flex min-h-[60px] items-center gap-3 border-t border-line py-2.5">
          <Skeleton className="size-7 rounded-control" />
          <div className="flex flex-col gap-2">
            <Skeleton className="h-3.5 w-32" />
            <Skeleton className="h-3 w-48" />
          </div>
        </div>
      ))}
    </div>
  );
}
