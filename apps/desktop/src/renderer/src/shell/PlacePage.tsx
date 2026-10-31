import type { ReactNode } from 'react';
import { IconButton, Tooltip } from '@architect/ui';
import { ChevronLeft } from 'lucide-react';

export interface PlacePageProps {
  title: string;
  /** At the right of the title: the page's one primary action, if it has one. */
  action?: ReactNode;
  /** Before the title, the way up to the place a page belongs to, named by `label`. */
  back?: { label: string; onClick: () => void };
  /** Beside the title, such as the page's status in a word. */
  status?: ReactNode;
  /** A panel at the page's right, full height, such as an inspector. */
  aside?: ReactNode;
  children: ReactNode;
}

/**
 * A place's page beside the sidebar: a strip that drags the window, the page's title, and its
 * content in a column that scrolls, with a panel at its right when the page has one. The panel
 * runs the window's full height, its edge unbroken from the top, and its own top strip drags the
 * window too.
 */
export function PlacePage({ title, back, action, status, aside, children }: PlacePageProps) {
  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="app-drag h-12 shrink-0" />
        <div className="min-h-0 flex-1 overflow-y-auto scroll-quiet">
          <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-8 px-10 pb-14 pt-4">
            <div className="flex min-h-12 items-center justify-between gap-4">
              <div className="flex min-w-0 items-center gap-3">
                {back && (
                  <Tooltip content={back.label} side="bottom">
                    <IconButton label={back.label} size="md" onClick={back.onClick}>
                      <ChevronLeft size={20} strokeWidth={1.8} aria-hidden />
                    </IconButton>
                  </Tooltip>
                )}
                <h1 className="m-0 truncate font-display text-title font-semibold">{title}</h1>
                {status}
              </div>
              {action}
            </div>
            {children}
          </div>
        </div>
      </div>
      {aside && (
        <div className="flex h-full shrink-0 flex-col">
          <div className="app-drag h-12 shrink-0 border-l border-line" />
          <div className="flex min-h-0 flex-1">{aside}</div>
        </div>
      )}
    </div>
  );
}
