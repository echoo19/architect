import { Button, Heading, StatusMark } from '@architect/ui';
import { DownloadButton } from '../../settings/models/StudentRows';
import type { Need } from './needs';

interface RunNeedsProps {
  needs: readonly Need[];
  /** Does what the need's button says, for every action but a download, which runs itself. */
  onAction: (need: Need) => void;
  /** The need whose action is working now, such as a check of the online copy. */
  busyId?: string | null;
}

/**
 * What a run can't start without, each with the one button that puts it right. Nothing at all
 * when nothing is missing, so the main path stays clear.
 */
export function RunNeeds({ needs, onAction, busyId = null }: RunNeedsProps) {
  if (needs.length === 0) return null;
  return (
    <section aria-labelledby="needs" className="flex flex-col gap-[18px]">
      <Heading id="needs">Before it can start</Heading>
      <ul className="m-0 flex list-none flex-col overflow-hidden rounded-card bg-card p-0 shadow-edge">
        {needs.map((need) => (
          <li
            key={need.id}
            className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-t border-line px-[22px] py-4 first:border-t-0"
          >
            <div className="flex min-w-0 flex-[1_1_300px] items-start gap-3">
              <StatusMark state="attention" size={18} className="mt-0.5" />
              <div className="flex min-w-0 flex-col gap-0.5">
                <span>{need.title}</span>
                <span className="text-small text-fg text-pretty">{need.detail}</span>
              </div>
            </div>
            {need.action.kind === 'download' ? (
              <DownloadButton model={need.action.model} label={need.label} />
            ) : (
              <Button size="xs" loading={busyId === need.id} onClick={() => onAction(need)}>
                {need.label}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
