import { Button, Collapse, StatusMark } from '@architect/ui';
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
 * when nothing is missing, so the main path stays clear; the list opens when something is missing
 * and closes when the last of it is put right.
 */
export function RunNeeds({ needs, onAction, busyId = null }: RunNeedsProps) {
  return (
    <Collapse open={needs.length > 0}>
      <div className="pb-10">
        <section
          aria-label="Before it can start"
          className="overflow-hidden rounded-card bg-card shadow-edge"
        >
          <ul className="m-0 flex list-none flex-col p-0">
            {needs.map((need) => (
              <li
                key={need.id}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-t border-line px-6 py-4 first:border-t-0"
              >
                <div className="flex min-w-0 flex-[1_1_300px] items-start gap-3">
                  <StatusMark state="attention" size={18} className="mt-0.5" />
                  <div className="flex min-w-0 flex-col">
                    <span className="font-medium">{need.title}</span>
                    <span className="text-small text-pretty">{need.detail}</span>
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
      </div>
    </Collapse>
  );
}
