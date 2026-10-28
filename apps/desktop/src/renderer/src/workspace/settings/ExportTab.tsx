import { useEffect, useState } from 'react';
import {
  slugify,
  type ExportItem,
  type ExportPart,
  type ExportPartName,
  type ExportReview,
  type GraduateSummary,
} from '@architect/shared';
import {
  Button,
  Checkbox,
  ErrorState,
  SettingsRow,
  SettingsSection,
  SettingsValue,
  Skeleton,
  StatusMark,
  Switch,
  toast,
} from '@architect/ui';
import {
  CircleAlert,
  Download,
  FileText,
  FolderTree,
  Info,
  LockKeyhole,
  Package,
  Puzzle,
} from 'lucide-react';
import { architect } from '../../api/client';
import { graduatesApi } from '../../api/graduates';
import { toError } from '../../api/query';
import { formatBytes } from '../../lib/format';
import { attempt } from '../../lib/notify';

interface ReviewState {
  review?: ExportReview;
  error?: Error;
  loading: boolean;
}

/**
 * What an export would carry, scanned, for one choice of optional items. It is read again when
 * the tab opens and whenever the choice changes; the last review stays on screen meanwhile.
 */
function useExportReview(graduateId: string, include: readonly string[]) {
  const choice = include.join(',');
  const [state, setState] = useState<ReviewState>({ loading: true });
  const [round, setRound] = useState(0);
  useEffect(() => {
    let live = true;
    setState((previous) => ({ ...previous, loading: true }));
    graduatesApi.reviewExport(graduateId, choice === '' ? [] : choice.split(',')).then(
      (review) => {
        if (live) setState({ review, loading: false });
      },
      (error: unknown) => {
        if (live) setState((previous) => ({ ...previous, error: toError(error), loading: false }));
      },
    );
    return () => {
      live = false;
    };
  }, [graduateId, choice, round]);
  return { ...state, reload: () => setRound((value) => value + 1) };
}

/** What each part is called once it leaves, as the engine names it. */
function partFile(review: ExportReview, part: ExportPartName): string {
  const base = `${slugify(review.name)}-v${review.version}`;
  if (part === 'harness') return `${base}-harness`;
  if (part === 'adapter') return `${base}-adapter.gguf`;
  return `${base}-report.md`;
}

const PARTS: Record<ExportPartName, { label: string; icon: typeof FolderTree; noun: string }> = {
  harness: { label: 'Setup', icon: FolderTree, noun: 'setup' },
  adapter: { label: 'Trained weights', icon: Puzzle, noun: 'trained weights' },
  report: { label: 'Evaluation report', icon: FileText, noun: 'evaluation report' },
};

/** What stays here, named the way the rest of the app names it. */
const KEPT_LABELS: Record<string, string> = {
  bindings: 'Your folder choices and model settings',
  credentials: 'API keys',
  training_traces: 'Attempts and notes from training',
};

/** "Files in data/" for a folder that can be shared; the engine's own words for the rest. */
function itemLabel(item: ExportItem): string {
  if (item.id.startsWith('resource:')) return `Files in ${item.id.slice('resource:'.length)}/`;
  return KEPT_LABELS[item.id] ?? item.label;
}

/** Asks for a folder to write into; null when the user closes the dialog. */
async function chooseFolder(title: string): Promise<string | null> {
  const [folder] = await architect().files.pick({ title, directory: true });
  return folder ?? null;
}

/**
 * Export: the package (`name.architect.zip`) after a review of what goes in and what stays here,
 * with the scan's findings and what no scan can promise; then the setup, the trained weights and
 * the report, each on its own.
 */
export function ExportTab({ agent }: { agent: GraduateSummary }) {
  const [include, setInclude] = useState<string[]>([]);
  const [acknowledged, setAcknowledged] = useState(false);
  const { review, error, loading, reload } = useExportReview(agent.id, include);
  const [busy, setBusy] = useState<'package' | ExportPartName | null>(null);

  if (!review) {
    return error ? (
      <ErrorState
        title="Couldn't review the export"
        message={error.message}
        onRetry={reload}
        className="py-12"
      />
    ) : (
      <ExportSkeleton />
    );
  }

  const included = review.items.filter((item) => item.included || item.optional);
  const left = review.items.filter((item) => !item.included && !item.optional);
  const archive = `${slugify(review.name)}-v${review.version}.architect.zip`;
  const findings = review.findings.length > 0;
  const blocked = findings && !acknowledged;
  const weights = review.parts.some((part) => part.part === 'adapter');
  const flaggedLines = review.findings.length;

  const share = (item: ExportItem, on: boolean) => {
    setAcknowledged(false);
    setInclude((current) =>
      on ? [...current, item.id] : current.filter((chosen) => chosen !== item.id),
    );
  };

  const exportPackage = async () => {
    setBusy('package');
    const written = await attempt(`Couldn't export ${agent.name}`, async () => {
      const directory = await chooseFolder(`Choose where to save ${archive}`);
      if (directory === null) return null;
      return graduatesApi.exportPackage(agent.id, {
        directory,
        include,
        ...(findings ? { acknowledgedFindings: review.findingsDigest } : {}),
      });
    });
    setBusy(null);
    if (written) toast({ title: `Exported ${agent.name}`, description: written.archive });
  };

  const exportPart = async (part: ExportPart) => {
    setBusy(part.part);
    const { noun } = PARTS[part.part];
    const written = await attempt(`Couldn't export the ${noun}`, async () => {
      const directory = await chooseFolder(`Choose where to save the ${noun}`);
      if (directory === null) return null;
      return graduatesApi.exportPart(agent.id, {
        part: part.part,
        directory,
        ...(acknowledged ? { acknowledgedFindings: part.findingsDigest } : {}),
      });
    });
    setBusy(null);
    if (written) toast({ title: `Exported the ${noun}`, description: written.path });
  };

  return (
    <div className="flex flex-col" aria-busy={loading || undefined}>
      <SettingsSection title="In the package">
        {included.map((item) =>
          item.optional ? (
            <SettingsRow
              key={item.id}
              icon={<StatusMark state={item.included ? 'ok' : 'off'} />}
              label={itemLabel(item)}
              meta={item.files.join(', ')}
              metaFont="code"
            >
              <div className="flex items-center gap-4">
                <SettingsValue>{formatBytes(item.bytes)}</SettingsValue>
                <Switch
                  checked={item.included}
                  onCheckedChange={(on) => share(item, on)}
                  aria-label={`Share the ${itemLabel(item).toLowerCase()}`}
                />
              </div>
            </SettingsRow>
          ) : (
            <SettingsRow
              key={item.id}
              icon={<StatusMark state="ok" />}
              label={item.label}
              meta={
                weights
                  ? 'Setup, trained weights, job and test results'
                  : 'Setup, model name, job and test results'
              }
            >
              <SettingsValue>{formatBytes(item.bytes)}</SettingsValue>
            </SettingsRow>
          ),
        )}
      </SettingsSection>

      <SettingsSection title="Scan">
        {findings ? (
          <>
            <SettingsRow
              icon={<StatusMark state="attention" />}
              label={`${review.findings.length} ${
                review.findings.length === 1 ? 'line looks' : 'lines look'
              } like a key or a private path`}
            >
              <Checkbox
                checked={acknowledged}
                onCheckedChange={setAcknowledged}
                label="Export anyway"
              />
            </SettingsRow>
            <ul aria-label="Findings" className="m-0 flex list-none flex-col gap-1.5 p-0 pb-3 pl-8">
              {review.findings.map((finding) => (
                <li
                  key={`${finding.path}:${finding.line}:${finding.kind}`}
                  className="flex min-w-0 gap-3 font-mono text-xs"
                >
                  <span className="shrink-0 text-fg-secondary">
                    {finding.path}:{finding.line}
                  </span>
                  <span className="truncate text-fg-muted">{finding.excerpt}</span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <SettingsRow
            icon={<StatusMark state="ok" />}
            label="Nothing that looks like a key or a private path"
          />
        )}
        <SettingsRow
          icon={<Info size={16} strokeWidth={1.8} aria-hidden className="text-fg-faint" />}
          label={
            weights
              ? 'Trained weights may retain information from their training data'
              : 'Its setup is written from your tasks and may quote them'
          }
        />
      </SettingsSection>

      <SettingsSection title="Stays on this computer">
        {left.map((item) => (
          <SettingsRow
            key={item.id}
            density="compact"
            icon={<LockKeyhole size={16} strokeWidth={1.7} aria-hidden className="text-fg-faint" />}
            label={itemLabel(item)}
          />
        ))}
      </SettingsSection>

      <SettingsSection title="Export one part">
        {review.parts.map((part) => {
          const { label, icon: Icon } = PARTS[part.part];
          const flagged = review.findings.some((finding) => part.files.includes(finding.path));
          return (
            <SettingsRow
              key={part.part}
              icon={
                <span className="flex size-7 items-center justify-center rounded-md bg-hover text-fg-secondary">
                  <Icon size={15} strokeWidth={1.7} aria-hidden />
                </span>
              }
              label={label}
              meta={`${partFile(review, part.part)} · ${formatBytes(part.bytes)}`}
              metaFont="code"
            >
              <Button
                size="xs"
                loading={busy === part.part}
                disabled={busy !== null || (flagged && !acknowledged)}
                onClick={() => void exportPart(part)}
                aria-label={`Export the ${PARTS[part.part].noun}`}
              >
                {busy !== part.part && <Download size={14} strokeWidth={1.7} aria-hidden />}
                Export
              </Button>
            </SettingsRow>
          );
        })}
      </SettingsSection>

      {/* Pinned over the tab's bottom padding, so nothing scrolls by beneath it. */}
      <div className="sticky -bottom-6 -mx-7 -mb-6 mt-6 flex flex-wrap items-center justify-end gap-x-5 gap-y-3 border-t border-line-card bg-modal px-7 py-4">
        {blocked && (
          <p className="m-0 mr-auto flex min-w-0 items-center gap-2 text-sm text-fg-muted">
            <CircleAlert size={15} strokeWidth={1.8} aria-hidden className="shrink-0" />
            {flaggedLines} flagged {flaggedLines === 1 ? 'line needs' : 'lines need'} your OK
          </p>
        )}
        <Button
          variant="primary"
          size="sm"
          loading={busy === 'package'}
          disabled={busy !== null || blocked || loading}
          onClick={() => void exportPackage()}
        >
          {busy !== 'package' && <Package size={15} strokeWidth={1.7} aria-hidden />}
          Export {archive}
        </Button>
      </div>
    </div>
  );
}

function ExportSkeleton() {
  return (
    <div aria-busy="true" aria-label="Reviewing the export" className="flex flex-col gap-6 pt-3">
      {[3, 4, 1].map((rows, section) => (
        <div key={section} className="flex flex-col gap-4">
          <Skeleton className="h-3 w-28" />
          {Array.from({ length: rows }, (_, row) => (
            <div key={row} className="flex items-center gap-3">
              <Skeleton shape="circle" className="size-4" />
              <Skeleton className="h-3.5 w-56" />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
