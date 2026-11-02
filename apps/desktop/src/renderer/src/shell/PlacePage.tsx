import type { ReactNode } from 'react';
import { Button, IconButton, Tooltip } from '@architect/ui';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export interface PlacePageProps {
  title: string;
  /** At the right of the title: the page's one primary action, if it has one. */
  action?: ReactNode;
  /** Before the title, the way back to the place a page belongs to, by the place's name. */
  back?: { label: string; onClick: () => void };
  /**
   * Above the title, what the page's thing belongs to, by name, such as an experiment's field:
   * a breadcrumb that opens it.
   */
  crumb?: { label: string; icon?: ReactNode; onClick: () => void };
  /** Beside the title, such as the page's status in a word. */
  status?: ReactNode;
  /** One quiet line under the title, for the one page that has to say what the app does. */
  lede?: ReactNode;
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
export function PlacePage({
  title,
  back,
  crumb,
  action,
  status,
  lede,
  aside,
  children,
}: PlacePageProps) {
  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="app-drag h-12 shrink-0" />
        {/* The scrollbar's room is kept whether or not the page scrolls, so a page's header
            doesn't shift as its tabs change length. */}
        <div className="min-h-0 flex-1 overflow-y-auto scroll-quiet [scrollbar-gutter:stable]">
          <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-8 px-10 pb-14 pt-4">
            {/* When the title and the action don't fit on one line, the action goes under it. */}
            <div className="flex min-h-12 flex-wrap items-center justify-between gap-x-6 gap-y-3">
              {crumb && (
                <nav aria-label="Breadcrumb" className="-mb-2 flex basis-full items-center gap-1">
                  <Button variant="ghost" size="sm" onClick={crumb.onClick} className="-ml-3.5">
                    {crumb.icon}
                    {crumb.label}
                  </Button>
                  <ChevronRight size={16} strokeWidth={1.8} aria-hidden />
                </nav>
              )}
              <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
                {back && (
                  <Tooltip content={`Back to ${back.label}`} side="bottom">
                    <IconButton label={`Back to ${back.label}`} size="md" onClick={back.onClick}>
                      <ChevronLeft size={20} strokeWidth={1.8} aria-hidden />
                    </IconButton>
                  </Tooltip>
                )}
                <h1 className="m-0 min-w-0 break-words font-display text-title font-semibold text-balance">
                  {title}
                </h1>
                {status}
              </div>
              {action && <div className="ml-auto flex shrink-0">{action}</div>}
            </div>
            {lede && <p className="-mt-5 mb-0 max-w-[760px] text-body text-pretty">{lede}</p>}
            {children}
          </div>
        </div>
      </div>
      {aside && (
        <div className="flex h-full shrink-0 flex-col">
          <div className="app-drag h-12 shrink-0" />
          <div className="flex min-h-0 flex-1">{aside}</div>
        </div>
      )}
    </div>
  );
}
