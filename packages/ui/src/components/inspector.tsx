import { useId, useState, type ReactNode } from 'react';
import { motion } from 'motion/react';
import { PanelRightClose, PanelRightOpen } from 'lucide-react';
import { Tabs } from 'radix-ui';
import { cn } from '../lib/cn';
import { springs } from '../motion/springs';
import { IconButton } from './icon-button';
import { Tooltip } from './tooltip';

export interface InspectorTab<T extends string> {
  value: T;
  label: string;
  /** A 16px Lucide icon; the only mark a tab has while the inspector is folded. */
  icon: ReactNode;
}

export interface InspectorProps<T extends string> {
  /** The panel's name, such as "Settings". */
  'aria-label': string;
  tabs: readonly InspectorTab<T>[];
  /**
   * Keeps the chosen tab and whether the panel is folded under this name, so the inspector opens
   * as it was left. Without it, it opens on the first tab, unfolded.
   */
  rememberAs?: string;
  /** Above the tabs while the panel is open: what it is about, such as a model's name. */
  header?: ReactNode;
  /** What the open tab shows. */
  children: (tab: T) => ReactNode;
  className?: string;
}

/** How wide the inspector is, open and folded. */
export const INSPECTOR_WIDTH = { open: 360, folded: 56 } as const;

interface Remembered {
  tab?: string;
  folded?: boolean;
}

const storageKey = (name: string) => `architect.inspector.${name}`;

/**
 * What an inspector kept under a name: its tab, if that tab still exists, and whether it was
 * folded. Storage that is missing, blocked or holds something else reads as nothing kept.
 */
export function readInspector<T extends string>(
  storage: Pick<Storage, 'getItem'> | undefined,
  name: string,
  tabs: readonly InspectorTab<T>[],
): { tab: T | undefined; folded: boolean } {
  let kept: Remembered = {};
  try {
    const raw = storage?.getItem(storageKey(name));
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (parsed && typeof parsed === 'object') kept = parsed as Remembered;
  } catch {
    // Unreadable storage keeps nothing; the inspector opens as new.
    kept = {};
  }
  const tab = tabs.find((t) => t.value === kept.tab)?.value;
  return { tab, folded: kept.folded === true };
}

function browserStorage(): Storage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

function keep(name: string | undefined, state: Remembered): void {
  if (!name) return;
  try {
    browserStorage()?.setItem(storageKey(name), JSON.stringify(state));
  } catch {
    // Storage full or blocked: the inspector still works, it just won't open this way next time.
  }
}

/**
 * The panel at a screen's right with the settings of what the screen shows, in tabs. It folds to
 * a rail of the tabs' icons, and opens again on the tab chosen there.
 */
export function Inspector<T extends string>({
  tabs,
  rememberAs,
  header,
  children,
  className,
  ...props
}: InspectorProps<T>) {
  const first = tabs[0]?.value;
  const [state, setState] = useState(() => {
    const kept = rememberAs
      ? readInspector(browserStorage(), rememberAs, tabs)
      : { tab: undefined, folded: false };
    return { tab: kept.tab ?? first, folded: kept.folded };
  });
  const indicator = useId();
  const update = (next: { tab: T | undefined; folded: boolean }) => {
    setState(next);
    keep(rememberAs, next);
  };
  const tab = state.tab ?? first;
  if (tab === undefined) return null;

  return (
    <motion.aside
      aria-label={props['aria-label']}
      initial={false}
      animate={{ width: state.folded ? INSPECTOR_WIDTH.folded : INSPECTOR_WIDTH.open }}
      transition={springs.smooth}
      data-folded={state.folded || undefined}
      className={cn(
        'flex h-full shrink-0 flex-col overflow-hidden border-l border-line bg-ground',
        className,
      )}
    >
      {state.folded ? (
        <div className="flex flex-col items-center gap-1 py-3">
          <Tooltip content="Open" side="left">
            <IconButton
              label={`Open ${props['aria-label']}`}
              size="md"
              onClick={() => update({ tab, folded: false })}
            >
              <PanelRightOpen size={16} strokeWidth={1.7} aria-hidden />
            </IconButton>
          </Tooltip>
          <div className="my-1 h-px w-6 bg-line" />
          {tabs.map((t) => (
            <Tooltip key={t.value} content={t.label} side="left">
              <IconButton
                label={t.label}
                size="md"
                aria-current={t.value === tab ? 'true' : undefined}
                className="[&_svg]:size-4"
                onClick={() => update({ tab: t.value, folded: false })}
              >
                {t.icon}
              </IconButton>
            </Tooltip>
          ))}
        </div>
      ) : (
        <Tabs.Root
          value={tab}
          onValueChange={(next) => {
            const match = tabs.find((t) => t.value === next);
            if (match) update({ tab: match.value, folded: false });
          }}
          className="flex min-h-0 w-[360px] flex-1 flex-col"
        >
          {header}
          <div className="flex items-center gap-2 px-3 pb-2 pt-3">
            <Tabs.List
              aria-label={props['aria-label']}
              className="flex min-w-0 flex-1 rounded-control bg-field p-[3px] shadow-edge"
            >
              {tabs.map((t) => (
                <Tabs.Trigger
                  key={t.value}
                  value={t.value}
                  className={cn(
                    'relative h-8 min-w-0 flex-1 rounded-mark px-2 text-small font-medium',
                    'transition-colors duration-150 hover:bg-hover',
                  )}
                >
                  {t.value === tab && (
                    <motion.span
                      layoutId={indicator}
                      transition={springs.snappy}
                      aria-hidden
                      className="absolute inset-0 rounded-mark bg-raised shadow-edge-strong"
                    />
                  )}
                  <span className="relative block truncate">{t.label}</span>
                </Tabs.Trigger>
              ))}
            </Tabs.List>
            <Tooltip content="Fold" side="left">
              <IconButton
                label={`Fold ${props['aria-label']}`}
                size="md"
                onClick={() => update({ tab, folded: true })}
              >
                <PanelRightClose size={16} strokeWidth={1.7} aria-hidden />
              </IconButton>
            </Tooltip>
          </div>
          <Tabs.Content
            value={tab}
            className="min-h-0 flex-1 overflow-y-auto px-5 pb-6 pt-3 focus-visible:outline-none"
          >
            {children(tab)}
          </Tabs.Content>
        </Tabs.Root>
      )}
    </motion.aside>
  );
}
