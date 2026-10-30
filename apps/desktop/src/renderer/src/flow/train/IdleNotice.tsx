import { useEffect, useState } from 'react';
import { Button, Disclosure } from '@architect/ui';
import { KeyRound, ToggleLeft, ToggleRight } from 'lucide-react';
import { useHubToken } from '../../api/hooks';
import { navigate, paths } from '../../lib/router';
import { useUi } from '../../state/ui';
import { askForAdvanced } from '../define/advanced-request';
import { tokenState } from '../define/teacher-menu';
import { modelNames } from '../names';
import { idleView, type IdleView } from './idle';
import type { LiveRun } from './run-state';

/**
 * Why a run ended before it could teach: the teacher had nothing it may change (decision 063).
 * The job turned off every way to change the agent that could run here, so nothing was spent. It
 * says in plain words what is off and what is missing, with a button that takes the person to the
 * teacher's settings to turn a change back on and, while the Hugging Face key is what is missing,
 * the way to add it. The engine's own sentence is kept under Details.
 */
export function IdleNotice({ live }: { live: LiveRun }) {
  const token = useHubToken();
  const openSettings = useUi((state) => state.openSettings);
  // The key may have been added anywhere since the run ended, so it is read again when this opens.
  const { reload } = token;
  useEffect(() => reload(), [reload]);
  const [asked, setAsked] = useState(false);
  const state = tokenState(token);
  const view = idleView(live, { token: state, keyAdded: asked && state === 'found' });
  const { run } = live;
  return (
    <IdleNoticeView
      view={view}
      teacher={modelNames(live.job).mentor}
      reason={run.error}
      onOpenTeacher={() => {
        askForAdvanced(run.jobId, 'teaching');
        navigate(paths.define(run.jobId));
      }}
      onAddKey={() => {
        setAsked(true);
        openSettings('models', 'huggingface');
      }}
    />
  );
}

interface IdleNoticeViewProps {
  view: IdleView;
  /** The teacher's short name, which its tab in Advanced settings is named for. */
  teacher: string;
  /** The engine's own sentence, for whoever wants it. */
  reason: string | undefined;
  onOpenTeacher: () => void;
  onAddKey: () => void;
}

/** The notice as it is shown, with nothing but what it is given. */
export function IdleNoticeView({
  view,
  teacher,
  reason,
  onOpenTeacher,
  onAddKey,
}: IdleNoticeViewProps) {
  return (
    <div
      role="status"
      aria-label={view.title}
      className="flex items-start gap-3 rounded-card bg-field px-5 py-4 shadow-edge"
    >
      <ToggleLeft size={16} className="mt-0.5 shrink-0 text-mentor" aria-hidden />
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex flex-col gap-0.5">
          <span className="font-medium">{view.title}</span>
          <span className="max-w-[760px] text-fg text-pretty">{view.body}</span>
          {view.next !== null && (
            <span className="max-w-[760px] text-fg text-pretty">{view.next}</span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={onOpenTeacher}>
            {view.turnOn ? (
              <>
                <ToggleRight size={14} aria-hidden />
                Turn a change back on
              </>
            ) : (
              <>Open {teacher}&apos;s settings</>
            )}
          </Button>
          {view.missingKey && (
            <Button size="sm" onClick={onAddKey}>
              <KeyRound size={14} aria-hidden />
              Add the Hugging Face key
            </Button>
          )}
        </div>
        {reason !== undefined && (
          <Disclosure label="Details">
            <p className="m-0 text-small text-fg text-pretty">{reason}</p>
          </Disclosure>
        )}
      </div>
    </div>
  );
}
