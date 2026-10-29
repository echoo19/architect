import type { CSSProperties, ReactNode } from 'react';
import {
  AgentAvatar,
  Button,
  cn,
  IconButton,
  SettingsRow,
  SettingsSection,
  SettingsValue,
  StatusMark,
  Switch,
} from '@architect/ui';
import { Copy, ExternalLink, Info, Package, UploadCloud, X } from 'lucide-react';
import { AppWindow, ChatHeader, Sidebar } from './frame';
import { at } from './motion';
import { noop } from './noop';
import { ChapterStage } from './stage';

const TABS = ['General', 'Permissions', 'Teaching', 'Results', 'Export'] as const;

const AGENTS = [
  {
    name: 'Service desk',
    chats: [
      { title: 'Price the two jobs Dana finished' },
      { title: 'Close out Tuesday', current: true },
    ],
  },
  { name: 'Returns desk', chats: [{ title: 'Can order 1187 come back?' }] },
];

/** When the chapter's moments happen, in ms from the start. */
const DIALOG = 350;
const EXPORT = 2900;
const SWITCH = 4700;
const HUB = 5000;
const PUBLISH = 7000;
const PUBLISHED = 7350;

/** The two places an agent can go, as the Export tab's switch shows them. */
function Destination() {
  const item = 'relative flex h-[30px] items-center rounded-sm px-3 text-sm';
  const pill = 'absolute inset-0 rounded-sm bg-segment-active shadow-segment';
  return (
    <div
      role="group"
      aria-label="Export to"
      className="mb-3 inline-flex shrink-0 self-start rounded-md bg-hover p-[3px]"
    >
      <span className={cn(item, 'text-fg-secondary')}>
        <span
          aria-hidden
          className={cn(pill, 'a a-unwipe motion-only')}
          style={at(SWITCH, { dur: 360 })}
        />
        <span
          className="a a-color relative"
          style={at(SWITCH, { dur: 360, vars: { '--from-color': 'var(--color-fg)' } })}
        >
          Package file
        </span>
      </span>
      <span className={cn(item, 'text-fg')}>
        <span aria-hidden className={cn(pill, 'a a-wipe')} style={at(SWITCH + 100, { dur: 360 })} />
        <span
          className="a a-color relative"
          style={at(SWITCH + 100, {
            dur: 360,
            vars: { '--from-color': 'var(--color-fg-secondary)' },
          })}
        >
          Hugging Face
        </span>
      </span>
    </div>
  );
}

function Row({
  style,
  className,
  children,
}: {
  style: CSSProperties;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn('a a-up', className)} style={style}>
      {children}
    </div>
  );
}

/** The package file: what goes in it, what the scan found, and the one file it makes. */
function PackageLayer() {
  const start = DIALOG + 600;
  return (
    <div
      className="a a-exit-left motion-only absolute inset-0 px-7"
      style={at(SWITCH + 250, { dur: 340, dx: 30 })}
    >
      <div className="pt-1">
        <SettingsSection title="In the package">
          <Row style={at(start, { dy: 12 })}>
            <SettingsRow
              icon={<StatusMark state="ok" />}
              label="Service desk, version 2"
              meta="Setup, trained weights, job and test results"
            >
              <SettingsValue>118 MB</SettingsValue>
            </SettingsRow>
          </Row>
          <Row style={at(start + 250, { dy: 12 })}>
            <SettingsRow
              icon={<StatusMark state="off" />}
              label="Files in data/"
              meta={
                <span className="font-mono">
                  jobs.csv, invoices.csv, technicians.csv, bookings.csv, policy.md
                </span>
              }
            >
              <div className="flex items-center gap-4">
                <SettingsValue>1 MB</SettingsValue>
                <Switch
                  checked={false}
                  onCheckedChange={noop}
                  aria-label="Share the files in data"
                />
              </div>
            </SettingsRow>
          </Row>
        </SettingsSection>
        <SettingsSection title="Scan">
          <Row style={at(start + 650, { dy: 12 })}>
            <SettingsRow
              icon={<StatusMark state="ok" />}
              label="Nothing in the package looks like a key or a private path"
            />
          </Row>
          <Row style={at(start + 900, { dy: 12 })}>
            <SettingsRow
              icon={<Info size={16} strokeWidth={1.8} aria-hidden className="text-fg-faint" />}
              label="Trained weights may retain information from their training data"
            />
          </Row>
        </SettingsSection>
      </div>
    </div>
  );
}

const field =
  'flex h-[38px] items-center rounded-md border border-line-control bg-well px-3 font-mono text-sm text-fg';

/** Hugging Face: the repository, private unless chosen, and where it ended up. */
function HubLayer() {
  return (
    <div className="absolute inset-0 px-7">
      <div className="a a-up pt-1" style={at(HUB - 100, { dy: 8, dur: 360 })}>
        <SettingsSection title="Repository">
          <Row style={at(HUB, { dy: 12 })}>
            <SettingsRow label="Name">
              <span className={cn(field, 'w-64 narrow:w-44')}>
                {'dana/service-desk'.split('').map((letter, index) => (
                  <span
                    key={index}
                    className="a a-up inline-block"
                    style={at(HUB + 250 + index * 38, { dy: 3, dur: 160 })}
                  >
                    {letter}
                  </span>
                ))}
              </span>
            </SettingsRow>
          </Row>
          <Row style={at(HUB + 200, { dy: 12 })}>
            <SettingsRow
              label="Visibility"
              meta="Only accounts you allow on Hugging Face can see it"
            >
              <div className="inline-flex shrink-0 rounded-md bg-hover p-[3px]">
                <span className="flex h-[30px] items-center rounded-sm bg-segment-active px-3 text-sm text-fg shadow-segment">
                  Private
                </span>
                <span className="flex h-[30px] items-center rounded-sm px-3 text-sm text-fg-secondary">
                  Public
                </span>
              </div>
            </SettingsRow>
          </Row>
          <Row style={at(HUB + 400, { dy: 12 })}>
            <SettingsRow label="Token">
              <SettingsValue>Token saved</SettingsValue>
            </SettingsRow>
          </Row>
        </SettingsSection>
        <div className="a a-unfold" style={at(PUBLISHED, { dur: 560 })}>
          <SettingsSection title="Published" className="pt-5">
            <SettingsRow
              icon={<StatusMark state="ok" label="Published" />}
              label="Version 2 is on Hugging Face"
              meta="Commit 3f9a2c1 · Private"
            >
              <Button size="xs" tabIndex={-1}>
                <ExternalLink size={14} strokeWidth={1.7} aria-hidden />
                <span>
                  <span className="narrow:hidden">huggingface.co/</span>dana/service-desk
                </span>
              </Button>
            </SettingsRow>
            <div className="flex items-center justify-between gap-3 border-t border-line-card py-3 narrow:hidden">
              <code className="min-w-0 truncate font-mono text-sm text-fg-secondary">
                architect install hf://dana/service-desk --revision 3f9a2c1
              </code>
              <IconButton label="Copy the command" size="xs" tabIndex={-1}>
                <Copy size={14} strokeWidth={1.7} aria-hidden />
              </IconButton>
            </div>
          </SettingsSection>
        </div>
      </div>
    </div>
  );
}

/** The bar along the dialog's bottom: the one button that does what the tab shows. */
function Actions() {
  return (
    <div className="grid min-h-[68px] shrink-0 border-t border-line-card px-7 py-3.5 [&>*]:[grid-area:1/1]">
      <div
        className="a a-exit-up motion-only flex items-center justify-end"
        style={at(SWITCH + 250, { dur: 260, dy: 0 })}
      >
        <span className="a a-press inline-flex" style={at(EXPORT, { dur: 320 })}>
          <Button variant="primary" size="sm" tabIndex={-1}>
            <Package size={15} strokeWidth={1.7} aria-hidden />
            Export service-desk-v2.architect.zip
          </Button>
        </span>
      </div>
      <div
        className="a a-up flex items-center justify-end"
        style={at(SWITCH + 300, { dy: 10, dur: 320 })}
      >
        <span className="grid">
          <span
            className="a a-exit-up motion-only [grid-area:1/1]"
            style={at(PUBLISHED - 100, { dur: 200, dy: 0 })}
          >
            <span className="a a-press inline-flex" style={at(PUBLISH, { dur: 320 })}>
              <Button variant="primary" size="sm" tabIndex={-1}>
                <UploadCloud size={15} strokeWidth={1.7} aria-hidden />
                Publish version 2
              </Button>
            </span>
          </span>
          <span className="a a-pop [grid-area:1/1]" style={at(PUBLISHED, { dur: 300 })}>
            <Button variant="primary" size="sm" disabled tabIndex={-1}>
              <UploadCloud size={15} strokeWidth={1.7} aria-hidden />
              Published
            </Button>
          </span>
        </span>
      </div>
    </div>
  );
}

/** What the app says when the file is written, for the moment it is there. */
function Toast() {
  return (
    <div
      className="a a-exit-up motion-only absolute bottom-4 right-4 z-10 w-[300px] narrow:left-4 narrow:w-auto"
      style={at(SWITCH - 300, { dur: 300, dy: 0 })}
    >
      <div
        className="a a-from-right flex flex-col gap-0.5 rounded-xl border border-line-control bg-modal px-4 py-3 shadow-popover"
        style={at(EXPORT + 250, { dx: 40, dur: 520 })}
      >
        <span className="font-medium">Exported Service desk</span>
        <span className="truncate font-mono text-sm text-fg-muted">
          service-desk-v2.architect.zip
        </span>
      </div>
    </div>
  );
}

/** The agent settings dialog on its Export tab. */
function Dialog() {
  return (
    <div
      className={cn(
        'a a-up absolute inset-y-6 inset-x-0 mx-auto flex w-[780px] max-w-[calc(100%-24px)]',
        'overflow-hidden rounded-3xl border border-line-control bg-modal shadow-modal',
        'narrow:inset-y-3 narrow:w-auto narrow:max-w-none',
      )}
      style={at(DIALOG, { dur: 760, dy: 30 })}
    >
      <div className="flex w-[196px] shrink-0 flex-col gap-0.5 border-r border-line-card bg-modal-rail px-2.5 py-[18px] narrow:hidden">
        <div className="mb-2.5 flex h-9 items-center gap-2.5 px-2.5 text-md font-medium">
          <AgentAvatar name="Service desk" className="text-[13px]!" />
          <span className="truncate">Service desk</span>
        </div>
        {TABS.map((tab) => (
          <span
            key={tab}
            className={cn(
              'flex h-9 items-center rounded-[9px] px-2.5',
              tab === 'Export' ? 'bg-tab-active text-fg' : 'text-fg-secondary',
            )}
          >
            {tab}
          </span>
        ))}
      </div>
      <div className="relative flex min-w-0 flex-1 flex-col">
        <div className="flex min-h-16 shrink-0 items-center justify-between gap-3 py-2.5 pl-7 pr-3">
          <h3 className="m-0 text-xl font-medium tracking-tight">Export</h3>
          <IconButton label="Close" tabIndex={-1}>
            <X size={16} strokeWidth={1.8} aria-hidden />
          </IconButton>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">
          <div className="px-7">
            <Destination />
          </div>
          <div className="relative h-[330px]">
            <PackageLayer />
            <HubLayer />
          </div>
        </div>
        <Actions />
      </div>
    </div>
  );
}

/**
 * Sharing: the Export tab writes the agent as one file, or publishes it to a private repository
 * on Hugging Face. The chapter plays the file first and ends on the repository.
 */
export function ShareMock() {
  return (
    <ChapterStage
      id="share"
      label="The Architect Export tab. The agent, Service desk version 2, is written as one package file, and the scan finds nothing that looks like a key or a private path. Then it is published to a private repository on Hugging Face, where the version and its commit are listed."
      heightWide={690}
      heightCompact={745}
    >
      <AppWindow className="inset-x-3 bottom-3 top-3 wide:inset-x-7 wide:top-6">
        <div className="absolute inset-0 flex narrow:hidden">
          <Sidebar agents={AGENTS} />
          <div className="flex min-w-0 flex-1 flex-col">
            <ChatHeader title="Close out Tuesday" />
          </div>
        </div>
        <div
          className="a a-scrim absolute inset-0 bg-backdrop narrow:hidden"
          style={at(DIALOG - 100, { dur: 500 })}
        />
        <Dialog />
        <Toast />
      </AppWindow>
    </ChapterStage>
  );
}
