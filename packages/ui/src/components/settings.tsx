import { Fragment, type ReactNode } from 'react';
import { CircleAlert, X } from 'lucide-react';
import { Dialog as RadixDialog, Tabs } from 'radix-ui';
import { cn } from '../lib/cn';
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
          <div className="flex max-h-full flex-[1_1_200px] flex-col gap-0.5 overflow-y-auto border-r border-line-card bg-modal-rail px-2.5 py-[18px]">
            <div className="mb-2.5 flex h-9 items-center gap-2.5 px-2.5 text-md font-medium">
              {icon}
              <span className="truncate">{title}</span>
            </div>
            <Tabs.List aria-label={title} className="flex flex-col gap-0.5">
              {tabs.map((t, index) => (
                <Fragment key={t.value}>
                  {t.group && t.group !== tabs[index - 1]?.group && (
                    // The tabs keep their own names for assistive tech; the heading groups them by eye.
                    <span aria-hidden className="px-2.5 pb-1 pt-4 text-sm text-fg-muted">
                      {t.group}
                    </span>
                  )}
                  <Tabs.Trigger
                    value={t.value}
                    className={cn(
                      'flex h-9 items-center rounded-[9px] px-2.5 text-left text-fg-secondary',
                      'transition-colors duration-150 hover:text-fg',
                      'data-[state=active]:bg-tab-active data-[state=active]:text-fg',
                    )}
                  >
                    {t.label}
                  </Tabs.Trigger>
                </Fragment>
              ))}
            </Tabs.List>
          </div>
          <div className="flex max-h-full min-w-0 flex-[999_1_420px] flex-col">
            <div className="flex min-h-16 items-center justify-between gap-3 py-2.5 pl-7 pr-3">
              <h2 className="text-xl font-medium tracking-tight">{active?.label}</h2>
              <RadixDialog.Close asChild>
                <IconButton label="Close">
                  <X size={16} strokeWidth={1.8} aria-hidden />
                </IconButton>
              </RadixDialog.Close>
            </div>
            <Tabs.Content
              value={tab}
              className="min-h-0 flex-1 overflow-y-auto px-7 pb-6 focus-visible:outline-none"
            >
              {children}
            </Tabs.Content>
            {footer && (
              <div className="flex min-h-16 shrink-0 flex-wrap items-center justify-between gap-3 border-t border-line-card py-3 pl-7 pr-4">
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
  children,
}: SettingsRowProps) {
  return (
    <div className="flex min-h-[60px] flex-wrap items-center justify-between gap-x-5 gap-y-2.5 border-t border-line py-2.5">
      {icon && <div className="-mr-2 flex shrink-0 items-center">{icon}</div>}
      <div className="flex min-w-0 flex-[1_1_180px] flex-col gap-0.5">
        <span className={tone === 'danger' ? 'text-danger' : 'text-fg'}>{label}</span>
        {error ? (
          <span role="alert" className="flex items-start gap-1.5 text-sm text-fg-muted">
            <CircleAlert size={13} className="mt-[3px] shrink-0 text-danger" aria-hidden />
            {error}
          </span>
        ) : (
          meta && (
            <span
              className={cn(
                'text-fg-muted',
                metaFont === 'code' ? 'break-all font-mono text-xs' : 'text-sm text-pretty',
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
  return <span className="text-fg-secondary">{children}</span>;
}
