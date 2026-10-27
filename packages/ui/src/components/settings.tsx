import type { ReactNode } from 'react';
import { CircleAlert, X } from 'lucide-react';
import { Dialog as RadixDialog, Tabs } from 'radix-ui';
import { cn } from '../lib/cn';
import { Dialog, DialogContent } from './dialog';
import { IconButton } from './icon-button';

export interface SettingsTab<T extends string> {
  value: T;
  label: string;
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
          <div className="flex max-h-full flex-[1_1_200px] flex-col gap-0.5 border-r border-line-card bg-modal-rail px-2.5 py-[18px]">
            <div className="mb-2.5 flex h-9 items-center gap-2.5 px-2.5 text-md font-medium">
              {icon}
              <span className="truncate">{title}</span>
            </div>
            <Tabs.List aria-label={title} className="flex flex-col gap-0.5">
              {tabs.map((t) => (
                <Tabs.Trigger
                  key={t.value}
                  value={t.value}
                  className={cn(
                    'flex h-9 items-center rounded-[9px] px-2.5 text-left text-fg-secondary',
                    'transition-colors duration-150 hover:text-fg',
                    'data-[state=active]:bg-tab-active data-[state=active]:text-fg',
                  )}
                >
                  {t.label}
                </Tabs.Trigger>
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
          </div>
        </Tabs.Root>
      </DialogContent>
    </Dialog>
  );
}

export interface SettingsRowProps {
  label: string;
  /** A short mono line under the label: a model id, a path, a size. */
  meta?: ReactNode;
  /** Why the row's value couldn't load. Replaces the meta line; pair it with a retry control. */
  error?: string;
  tone?: 'default' | 'danger';
  /** The control or value on the right. */
  children?: ReactNode;
}

export function SettingsRow({ label, meta, error, tone = 'default', children }: SettingsRowProps) {
  return (
    <div className="flex min-h-[60px] flex-wrap items-center justify-between gap-x-5 gap-y-2.5 border-t border-line py-2.5">
      <div className="flex min-w-0 flex-[1_1_180px] flex-col gap-0.5">
        <span className={tone === 'danger' ? 'text-danger' : 'text-fg'}>{label}</span>
        {error ? (
          <span role="alert" className="flex items-start gap-1.5 text-sm text-fg-muted">
            <CircleAlert size={13} className="mt-[3px] shrink-0 text-danger" aria-hidden />
            {error}
          </span>
        ) : (
          meta && <span className="break-all font-mono text-xs text-fg-muted">{meta}</span>
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
