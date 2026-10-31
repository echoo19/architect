import type { ReactNode } from 'react';

export interface PlacePageProps {
  title: string;
  /** At the right of the title: the page's one primary action, if it has one. */
  action?: ReactNode;
  /** Beside the title, such as the page's status in a word. */
  status?: ReactNode;
  /** A panel at the page's right, full height, such as an inspector. */
  aside?: ReactNode;
  children: ReactNode;
}

/**
 * A place's page beside the sidebar: a strip that drags the window, the page's title, and its
 * content in a column that scrolls, with a panel at its right when the page has one.
 */
export function PlacePage({ title, action, status, aside, children }: PlacePageProps) {
  return (
    <>
      <div className="app-drag h-12 shrink-0" />
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 overflow-y-auto scroll-quiet">
          <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-8 px-10 pb-14 pt-4">
            <div className="flex min-h-12 items-center justify-between gap-4">
              <div className="flex min-w-0 items-center gap-3">
                <h1 className="m-0 truncate font-display text-title font-semibold">{title}</h1>
                {status}
              </div>
              {action}
            </div>
            {children}
          </div>
        </div>
        {aside}
      </div>
    </>
  );
}
