import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { PanelRightClose, PanelRightOpen } from 'lucide-react';
import { Tabs } from 'radix-ui';
import { cn } from '../lib/cn';
import { useWindowBelow } from '../lib/window-width';
import { springs } from '../motion/springs';
import { StepTransition } from '../motion/step-transition';
import { IconButton } from './icon-button';
import { Tooltip } from './tooltip';

export interface InspectorTab<T extends string> {
  value: T;
  label: string;
  /** A 16px Lucide icon; the only mark a tab has while the inspector is folded. */
  icon: ReactNode;
  /**
   * Shows the icon in the strip, with the label as its name and tooltip: for a label too long to
   * sit beside the others uncut, such as a model's name.
   */
  iconOnly?: boolean;
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
  /**
   * The tab, when the screen chooses it too, such as a line that sends the person to the budget.
   * A tab chosen this way also unfolds the panel. Without it, the inspector keeps its own.
   */
  tab?: T;
  onTabChange?: (tab: T) => void;
  /**
   * Starts folded on a narrow window (`INSPECTOR_FOLDS_BELOW`) until the person opens or folds it
   * themselves, for a panel beside a page that needs its width more than the panel does. Opened
   * on a narrow window, it floats over the page from its rail rather than squeezing the page.
   */
  foldWhenNarrow?: boolean;
  /** Whether the panel is shown. Closing slides it shut; it stays mounted, so it keeps its tab. */
  open?: boolean;
  /** Above the tabs while the panel is open: what it is about, such as a model's name. */
  header?: ReactNode;
  /** What the open tab shows. */
  children: (tab: T) => ReactNode;
  className?: string;
}

/** How wide the inspector is, open and folded: open, five tabs fit side by side by name. */
export const INSPECTOR_WIDTH = { open: 408, folded: 56 } as const;

/**
 * How far the floating panel stands in from the window's right edge, from top and bottom, and,
 * open, from the page beside it, so the page's scrollbar reads as the page's.
 */
const INSPECTOR_INSET = 8;

/** The open panel and the rail trade places: the old one fades out fast as the new fades in. */
const swap = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: springs.settle },
  exit: { opacity: 0, transition: springs.leave },
} as const;

interface Remembered {
  tab?: string;
  folded?: boolean;
}

const storageKey = (name: string) => `architect.inspector.${name}`;

/**
 * Below this window width an inspector that folds when narrow, and was never folded or opened by
 * hand, starts folded, so the page beside it keeps room for its names and figures.
 */
const INSPECTOR_FOLDS_BELOW = 1400;

const narrowWindow = () =>
  typeof window !== 'undefined' && window.innerWidth < INSPECTOR_FOLDS_BELOW;

/** How wide the floating panel is, inside the inspector's width. */
const panelWidth = (width: number) =>
  width === INSPECTOR_WIDTH.open
    ? width - 2 * INSPECTOR_INSET
    : Math.max(0, width - INSPECTOR_INSET);

/**
 * What an inspector kept under a name: its tab, if that tab still exists, and whether it was
 * folded, or `folded` as given when that was never kept. Storage that is missing, blocked or
 * holds something else reads as nothing kept.
 */
export function readInspector<T extends string>(
  storage: Pick<Storage, 'getItem'> | undefined,
  name: string,
  tabs: readonly InspectorTab<T>[],
  folded = false,
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
  return { tab, folded: typeof kept.folded === 'boolean' ? kept.folded : folded };
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
  tab: asked,
  onTabChange,
  foldWhenNarrow = false,
  open = true,
  header,
  children,
  className,
  ...props
}: InspectorProps<T>) {
  const first = tabs[0]?.value;
  const [state, setState] = useState(() => {
    const folded = foldWhenNarrow && narrowWindow();
    const kept = rememberAs
      ? readInspector(browserStorage(), rememberAs, tabs, folded)
      : { tab: undefined, folded };
    return { tab: kept.tab ?? first, folded: kept.folded };
  });
  const indicator = useId();
  const update = (next: { tab: T | undefined; folded: boolean }) => {
    setState(next);
    keep(rememberAs, next);
    if (next.tab !== undefined && next.tab !== asked) onTabChange?.(next.tab);
  };
  // A tab the screen asks for opens the panel on it, folded or not.
  const lastAsked = useRef(asked);
  useEffect(() => {
    if (asked === undefined || asked === lastAsked.current) return;
    lastAsked.current = asked;
    const next = { tab: asked, folded: false };
    setState(next);
    keep(rememberAs, next);
  }, [asked, rememberAs]);
  const narrow = useWindowBelow(INSPECTOR_FOLDS_BELOW);
  const aside = useRef<HTMLElement>(null);
  const tab = asked ?? state.tab ?? first;
  const width = !open ? 0 : state.folded ? INSPECTOR_WIDTH.folded : INSPECTOR_WIDTH.open;
  // Opened on a narrow window, the panel floats over the page; the rail keeps its place.
  const overlay = foldWhenNarrow && narrow && width === INSPECTOR_WIDTH.open;
  // Floating, it folds again when the page under it is pointed at; a menu it opened, which
  // floats outside the page, leaves it open.
  useEffect(() => {
    if (!overlay) return;
    const away = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element) || aside.current?.contains(target)) return;
      if (!target.closest('main')) return;
      setState((current) => {
        const next = { ...current, folded: true };
        keep(rememberAs, next);
        return next;
      });
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [overlay, rememberAs]);
  if (tab === undefined) return null;

  return (
    <motion.aside
      ref={aside}
      aria-label={props['aria-label']}
      initial={false}
      animate={{ width: overlay ? INSPECTOR_WIDTH.folded : width }}
      transition={springs.smooth}
      data-folded={state.folded || undefined}
      data-overlay={overlay || undefined}
      aria-hidden={!open || undefined}
      className={cn('relative h-full shrink-0', overlay && 'z-20', className)}
    >
      {/*
        The panel floats 8px in from the window's edge. As the width springs, the open panel
        stays anchored at its left and slides with that edge, clipped, never squeezed; the rail
        stays anchored at the right. One fades out quickly as the other fades in.
      */}
      <motion.div
        initial={false}
        animate={{ width: panelWidth(width) }}
        transition={springs.smooth}
        className="absolute inset-y-2 right-2 overflow-hidden rounded-card surface-float"
      >
        <AnimatePresence initial={false}>
          {!open ? null : state.folded ? (
            <motion.div
              key="rail"
              {...swap}
              style={{ width: INSPECTOR_WIDTH.folded - INSPECTOR_INSET }}
              className="absolute inset-y-0 right-0 flex flex-col items-center gap-1 py-3"
            >
              <Tooltip content="Open" side="left">
                <IconButton
                  label={`Open ${props['aria-label']}`}
                  size="md"
                  onClick={() => update({ tab, folded: false })}
                >
                  <PanelRightOpen size={16} strokeWidth={1.8} aria-hidden />
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
            </motion.div>
          ) : (
            <motion.div
              key="open"
              {...swap}
              style={{ width: panelWidth(INSPECTOR_WIDTH.open) }}
              className="absolute inset-y-0 left-0 flex"
            >
              <Tabs.Root
                value={tab}
                onValueChange={(next) => {
                  const match = tabs.find((t) => t.value === next);
                  if (match) update({ tab: match.value, folded: false });
                }}
                className="flex min-h-0 min-w-0 flex-1 flex-col"
              >
                {header}
                <div className="flex items-center gap-2 px-4 pb-2 pt-4">
                  <Tabs.List
                    aria-label={props['aria-label']}
                    className="flex min-w-0 flex-1 rounded-full bg-field p-1 shadow-edge"
                  >
                    {tabs.map((t) => {
                      const trigger = (
                        <Tabs.Trigger
                          key={t.value}
                          value={t.value}
                          aria-label={t.iconOnly ? t.label : undefined}
                          className={cn(
                            'relative h-8 min-w-0 rounded-full text-small font-medium',
                            t.iconOnly ? 'w-10 shrink-0' : 'flex-auto px-[5px]',
                            'transition-colors duration-150 hover:bg-hover',
                          )}
                        >
                          {t.value === tab && (
                            <motion.span
                              layoutId={indicator}
                              transition={springs.snappy}
                              aria-hidden
                              className="absolute inset-0 rounded-full bg-raised shadow-edge-strong"
                            />
                          )}
                          {t.iconOnly ? (
                            <span className="relative flex justify-center">{t.icon}</span>
                          ) : (
                            <span className="relative block truncate">{t.label}</span>
                          )}
                        </Tabs.Trigger>
                      );
                      return t.iconOnly ? (
                        <Tooltip key={t.value} content={t.label} side="bottom">
                          {trigger}
                        </Tooltip>
                      ) : (
                        trigger
                      );
                    })}
                  </Tabs.List>
                  <Tooltip content="Fold" side="left">
                    <IconButton
                      label={`Fold ${props['aria-label']}`}
                      size="md"
                      onClick={() => update({ tab, folded: true })}
                    >
                      <PanelRightClose size={16} strokeWidth={1.8} aria-hidden />
                    </IconButton>
                  </Tooltip>
                </div>
                <Tabs.Content
                  value={tab}
                  className="min-h-0 flex-1 overflow-y-auto px-4 pb-6 pt-3 scroll-quiet focus-visible:outline-none"
                >
                  <StepTransition transitionKey={tab} kind="tab">
                    {children(tab)}
                  </StepTransition>
                </Tabs.Content>
              </Tabs.Root>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </motion.aside>
  );
}
