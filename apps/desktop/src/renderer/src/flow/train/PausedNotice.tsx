import { useEffect, type ReactNode } from 'react';
import { Button, Disclosure } from '@architect/ui';
import { CirclePause, Download, KeyRound, Power } from 'lucide-react';
import { useLocalRuntimes, useSecretsStatus } from '../../api/hooks';
import { DownloadButton } from '../../settings/models/StudentRows';
import { useUi } from '../../state/ui';
import { pauseProblems, type PauseProblem } from './pause';
import type { LiveRun } from './run-state';

const ICONS = { key: KeyRound, runtime: Power, model: Download } as const;

/**
 * Why a run is paused, and what puts it right, so Resume is never a blind retry. A run pauses when
 * something it needs isn't there: a key that isn't saved, a model that isn't downloaded, Ollama not
 * running. The screen looks at the computer now for those and offers the fix beside each; the
 * engine's own sentence says why it paused, whatever the cause, and waits under Details when a
 * cause was found. It is read from the run, so it is here whenever the run is opened, not only
 * while the pause was watched.
 */
export function PausedNotice({ live }: { live: LiveRun }) {
  const keys = useSecretsStatus();
  const local = useLocalRuntimes();
  const openSettings = useUi((state) => state.openSettings);
  const { reload: reloadKeys } = keys;
  const { reload: reloadLocal } = local;

  // What was true when the screen opened may not be now: a key can be added in Settings at any time.
  useEffect(() => {
    reloadKeys();
    reloadLocal();
  }, [reloadKeys, reloadLocal]);

  const problems = pauseProblems(live, { keys: keys.data ?? null, local: local.data ?? null });
  const what = live.improves ? 'Improving' : 'Training';
  const reason = live.run.error ?? 'It paused without saying why.';

  const fix = (problem: PauseProblem): ReactNode => {
    switch (problem.kind) {
      case 'key':
        return (
          <Button size="sm" onClick={() => openSettings('models')}>
            Add the key
          </Button>
        );
      case 'runtime':
        return (
          <Button size="sm" onClick={reloadLocal}>
            Check again
          </Button>
        );
      case 'model':
        return <DownloadButton model={problem.model} label="Download" />;
    }
  };

  return (
    <div
      role="status"
      aria-label={`${what} is paused`}
      className="flex items-start gap-3 rounded-card bg-field px-5 py-4 shadow-edge"
    >
      <CirclePause size={16} className="mt-0.5 shrink-0 text-mentor" aria-hidden />
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex flex-col gap-0.5">
          <span className="font-medium">{what} is paused</span>
          {problems.length === 0 && <span className="text-fg text-pretty">{reason}</span>}
        </div>
        {problems.length > 0 && (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {problems.map((problem) => {
              const Icon = ICONS[problem.kind];
              return (
                <li key={problem.text} className="flex items-center justify-between gap-4">
                  <span className="flex min-w-0 items-center gap-2.5 text-fg">
                    <Icon size={14} strokeWidth={1.8} aria-hidden className="shrink-0" />
                    <span className="text-pretty">{problem.text}</span>
                  </span>
                  {fix(problem)}
                </li>
              );
            })}
          </ul>
        )}
        <p className="m-0 text-small text-pretty">
          {problems.length > 0
            ? 'When that is put right, press Resume.'
            : 'Press Resume to try again.'}
        </p>
        {problems.length > 0 && (
          <Disclosure label="Details">
            <p className="m-0 text-small text-fg text-pretty">{reason}</p>
          </Disclosure>
        )}
      </div>
    </div>
  );
}
