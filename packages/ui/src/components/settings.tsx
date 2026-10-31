import { Fragment, useId, type ReactNode } from 'react';
import { motion } from 'motion/react';
import { CircleAlert, X } from 'lucide-react';
import { Dialog as RadixDialog, Tabs } from 'radix-ui';
import { cn } from '../lib/cn';
import { springs } from '../motion/springs';
import { Dialog, DialogContent } from './dialog';
import { IconButton } from './icon-button';

export interface SettingsTab<T extends string> {
  value: T;
  label: string;
  /** Tabs sharing a group sit together under its name in the rail, after the ungrouped ones. */
  group?: string;
}

export interface SettingsDialogProps<T extends string> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Shown at the top of the rail: "Settings", or an agent's name. */
  title: string;
  /** Optional mark before the title, such as an AgentAvatar. */
  icon?: ReactNode;
  tabs: readonly SettingsTab<T>[];
  tab: T;
  onTabChange: (tab: T) => void;
  /** A bar under the rows, such as a save status and a Done button. */
  footer?: ReactNode;
  /** Rows for the active tab. */
  children: ReactNode;
}

/** The settings modal: a rail of tabs on the left, rows of label, meta and control on the right. */
export function SettingsDialog<T extends string>({
  open,
  onOpenChange,
  title,
  icon,
  tabs,
  tab,
  onTabChange,
  footer,
  children,
}: SettingsDialogProps<T>) {
  const active = tabs.find((t) => t.value === tab) ?? tabs[0];
  // The selected tab's fill travels from one tab to the next.
  const indicator = useId();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={title} hideTitle size="lg">
        <Tabs.Root
          orientation="vertical"
          value={tab}
          onValueChange={(next) => {
            const match = tabs.find((t) => t.value === next);
            if (match) onTabChange(match.value);
          }}
          className="flex h-full flex-wrap"
        >
          <div className="flex max-h-full flex-[1_1_200px] flex-col gap-0.5 overflow-y-auto border-r border-line bg-card px-3 py-5">
            <div className="mb-2.5 flex h-10 items-center gap-2.5 px-2.5 font-display text-body font-semibold">
              {icon}
              <span className="truncate">{title}</span>
            </div>
            <Tabs.List aria-label={title} className="flex flex-col gap-0.5">
              {tabs.map((t, index) => (
                <Fragment key={t.value}>
                  {t.group && t.group !== tabs[index - 1]?.group && (
                    // The tabs keep their own names for assistive tech; the heading groups them by eye.
                    <span aria-hidden className="px-2.5 pb-1 pt-4 text-small font-medium">
                      {t.group}
                    </span>
                  )}
                  <Tabs.Trigger
                    value={t.value}
                    className="relative flex h-10 items-center rounded-control px-2.5 text-left text-ui transition-colors duration-150 hover:bg-hover data-[state=active]:font-medium"
                  >
                    {t.value === tab && (
                      <motion.span
                        layoutId={indicator}
                        transition={springs.snappy}
                        aria-hidden
                        className="absolute inset-0 rounded-control bg-selected"
                      />
                    )}
                    <span className="relative">{t.label}</span>
                  </Tabs.Trigger>
                </Fragment>
              ))}
            </Tabs.List>
          </div>
          <div className="flex max-h-full min-w-0 flex-[999_1_420px] flex-col">
            <div className="flex min-h-16 items-center justify-between gap-3 py-3 pl-6 pr-3">
              <h2 className="font-display text-h2 font-semibold">{active?.label}</h2>
              <RadixDialog.Close asChild>
                <IconButton label="Close">
                  <X size={16} strokeWidth={1.8} aria-hidden />
                </IconButton>
              </RadixDialog.Close>
            </div>
            <Tabs.Content
              value={tab}
              className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 scroll-quiet focus-visible:outline-none"
            >
              {children}
            </Tabs.Content>
            {footer && (
              <div className="flex min-h-16 shrink-0 flex-wrap items-center justify-between gap-3 border-t border-line py-3 pl-6 pr-4">
                {footer}
              </div>
            )}
          </div>
        </Tabs.Root>
      </DialogContent>
    </Dialog>
  );
}

export interface SettingsRowProps {
  label: string;
  /** A mark before the label, such as a provider's tile. */
  icon?: ReactNode;
  /** A short line under the label: what the setting does, or a fact such as a model id. */
  meta?: ReactNode;
  /** `code` sets the meta in mono, for a model id, a path or a web address. */
  metaFont?: 'text' | 'code';
  /** Why the row's value couldn't load. Replaces the meta line; pair it with a retry control. */
  error?: string;
  tone?: 'default' | 'danger';
  /** `compact` for a list of short entries with no meta, such as what an export leaves out. */
  density?: 'default' | 'compact';
  /** The control or value on the right. */
  children?: ReactNode;
}

export function SettingsRow({
  label,
  icon,
  meta,
  metaFont = 'text',
  error,
  tone = 'default',
  density = 'default',
  children,
}: SettingsRowProps) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-between gap-x-5 gap-y-2.5 border-t border-line',
        density === 'compact' ? 'min-h-10 py-2' : 'min-h-14 py-3',
      )}
    >
      {icon && <div className="-mr-2 flex shrink-0 items-center">{icon}</div>}
      <div className="flex min-w-0 flex-[1_1_180px] flex-col gap-0.5">
        <span className={cn('text-ui', tone === 'danger' && 'text-danger')}>{label}</span>
        {error ? (
          <span role="alert" className="flex items-start gap-1.5 text-small">
            <CircleAlert size={14} className="mt-[3px] shrink-0 text-danger" aria-hidden />
            {error}
          </span>
        ) : (
          meta && (
            <span
              className={cn(
                'text-small',
                metaFont === 'code' ? 'break-all font-mono' : 'text-pretty',
              )}
            >
              {meta}
            </span>
          )
        )}
      </div>
      {children}
    </div>
  );
}

/** A read-only value on the right of a settings row. */
export function SettingsValue({ children }: { children: ReactNode }) {
  return <span className="text-ui">{children}</span>;
}

export interface SettingsSectionProps {
  /** A short name over the rows, such as "Versions" or "Left out". */
  title: string;
  /** Controls at the right of the title. */
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}

/** Rows grouped under a title, for a tab that holds more than one list. */
export function SettingsSection({ title, actions, children, className }: SettingsSectionProps) {
  return (
    <section aria-label={title} className={cn('flex flex-col pt-6 first:pt-1', className)}>
      <div className="flex min-h-8 items-center justify-between gap-3 pb-2">
        <h3 className="m-0 text-small font-medium">{title}</h3>
        {actions}
      </div>
      {children}
    </section>
  );
}
