import type { ReactNode } from 'react';

export interface PlacePageProps {
  title: string;
  /** At the right of the title: the page's one primary action, if it has one. */
  action?: ReactNode;
  children: ReactNode;
}

/**
 * A place's page beside the sidebar: a strip that drags the window, the page's title, and its
 * content in a column that scrolls.
 */
export function PlacePage({ title, action, children }: PlacePageProps) {
  return (
    <>
      <div className="app-drag h-12 shrink-0" />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-8 px-10 pb-14 pt-4">
          <div className="flex min-h-12 items-center justify-between gap-4">
            <h1 className="m-0 font-display text-title font-semibold">{title}</h1>
            {action}
          </div>
          {children}
        </div>
      </div>
    </>
  );
}
