import { useEffect, useRef, useState } from 'react';
import {
  HubRepositorySchema,
  type GraduateSummary,
  type HubVisibility,
  type Publication,
  type PublicationReview,
  type PublishProgress,
  type PublishResult,
} from '@architect/shared';
import {
  Badge,
  Button,
  Checkbox,
  Drawer,
  DrawerContent,
  ErrorState,
  IconButton,
  Input,
  Progress,
  Segmented,
  SettingsRow,
  SettingsSection,
  SettingsValue,
  Skeleton,
  StatusMark,
} from '@architect/ui';
import {
  CircleAlert,
  Eye,
  ExternalLink,
  FileText,
  Info,
  KeyRound,
  Puzzle,
  UploadCloud,
} from 'lucide-react';
import { architect } from '../../api/client';
import { graduatesApi, usePublications } from '../../api/graduates';
import { useHubToken } from '../../api/hooks';
import { toError } from '../../api/query';
import { CopyButton } from '../../components/CopyButton';
import { errorOf, RetryButton } from '../../components/QueryValue';
import {
  bareUrl,
  installCommand,
  sentText,
  shortCommit,
  stageText,
  tokenSourceText,
  VISIBILITY_CHOICES,
  VISIBILITY_MEANINGS,
} from '../../hub/labels';
import { formatBytes } from '../../lib/format';
import { attempt } from '../../lib/notify';
import { useUi } from '../../state/ui';
import { Markdown } from '../markdown/Markdown';
import { useAgentSettingsUi } from './agentSettingsUi';
import { IDLE, lastTarget, startPublishing, usePublishing } from './publishing';
import { versionDate } from './versions';

/** The model card's name in the repository. */
const CARD = 'README.md';

/** A value that settles once it stops changing for `ms`, so typing doesn't review every key. */
function useSettled<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

interface ReviewState {
  review?: PublicationReview;
  error?: Error;
  loading: boolean;
}

/**
 * What publishing would send to a repository, scanned, read again whenever the repository or the
 * visibility changes. Nothing leaves this computer to make it.
 */
function usePublicationReview(
  graduateId: string,
  repository: string | null,
  visibility: HubVisibility,
) {
  const [state, setState] = useState<ReviewState>({ loading: false });
  const [round, setRound] = useState(0);
  useEffect(() => {
    if (repository === null) {
      setState({ loading: false });
      return;
    }
    let live = true;
    setState((previous) => ({ review: previous.review, loading: true }));
    graduatesApi.reviewPublication(graduateId, { repository, visibility }).then(
      (review) => {
        if (live) setState({ review, loading: false });
      },
      (error: unknown) => {
        if (live) setState({ error: toError(error), loading: false });
      },
    );
    return () => {
      live = false;
    };
  }, [graduateId, repository, visibility, round]);
  return { ...state, reload: () => setRound((value) => value + 1) };
}

/** Opens a page on Hugging Face in the browser. */
function openOnHub(url: string): void {
  void attempt("Couldn't open Hugging Face", () => architect().app.openLink(url));
}

/** Settings at Models, where the Hugging Face token is kept. The agent's settings close first. */
function openTokenSettings(): void {
  useAgentSettingsUi.getState().close();
  useUi.getState().openSettings('models');
}

/** The model card without its front matter, which the Hub shows as tags rather than text. */
function cardBody(card: string): string {
  return card.replace(/^---\n[\s\S]*?\n---\n+/, '');
}

/**
 * Publish to Hugging Face: the repository and its visibility (private unless chosen), where the
 * token comes from, every file that will go with the model card to preview, and the scan; then
 * the upload's progress, and the repository's link and commit, or the failure with what to do.
 * Publishing again after a failure finishes the same publication. Earlier publications are listed
 * with their repository, version, commit and date.
 */
export function PublishPanel({ agent }: { agent: GraduateSummary }) {
  const publications = usePublications(agent.id);
  const token = useHubToken();
  // Kept outside this tab, so closing the agent's settings never loses a publication on its way;
  // the tab opens again on what it last sent, and where.
  const state = usePublishing((store) => store.states[agent.id] ?? IDLE);
  const publishing = state.kind === 'publishing';
  const target = lastTarget(state);
  const last = target?.repository ?? publications.data?.at(-1)?.repository;
  const [typed, setTyped] = useState<string | null>(null);
  const repository = (typed ?? last ?? '').trim();
  const valid = HubRepositorySchema.safeParse(repository).success;
  const [visibility, setVisibility] = useState<HubVisibility>(target?.visibility ?? 'private');
  const settled = useSettled(valid ? repository : null, 300);
  const { review, error, loading, reload } = usePublicationReview(agent.id, settled, visibility);
  const [acknowledged, setAcknowledged] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const top = useRef<HTMLDivElement>(null);

  const current = review && review.repository === repository ? review : null;
  const findings = current?.findings.length ?? 0;
  const noToken = token.data?.source === null;
  // This version is on that repository now: publishing it there again would send nothing.
  const sent =
    state.kind === 'done' &&
    state.result.publication.repository === repository &&
    state.result.publication.version === current?.version;
  const unfinished = state.kind === 'failed' && state.repository === repository;
  const waiting = !valid
    ? noToken
      ? 'Name the repository as owner/name, and add a token'
      : 'Name the repository as owner/name'
    : noToken
      ? 'Add a Hugging Face token in Settings'
      : findings > 0 && !acknowledged
        ? `${findings} flagged ${findings === 1 ? 'line needs' : 'lines need'} your OK`
        : null;

  const publish = () => {
    if (!current) return;
    top.current?.scrollIntoView({ block: 'nearest' });
    void startPublishing(
      agent.id,
      { repository: current.repository, version: current.version, visibility },
      {
        repository: current.repository,
        visibility,
        ...(findings > 0 ? { acknowledgedFindings: current.findingsDigest } : {}),
      },
    );
  };

  return (
    <div className="flex flex-1 flex-col" aria-busy={loading || undefined}>
      <div ref={top} />
      {state.kind === 'publishing' && (
        <PublishingSection repository={state.repository} progress={state.progress} />
      )}
      {state.kind === 'done' && <PublishedSection result={state.result} />}
      {state.kind === 'failed' && (
        <SettingsSection title="Didn't finish" className="pt-1">
          <SettingsRow
            icon={<StatusMark state="blocked" label="Failed" />}
            label={`Couldn't publish version ${state.version} to ${state.repository}`}
            meta={state.message}
          />
        </SettingsSection>
      )}

      <SettingsSection title="Repository">
        <SettingsRow label="Name">
          <Input
            aria-label="Repository"
            aria-invalid={repository !== '' && !valid ? true : undefined}
            placeholder="owner/name"
            value={typed ?? last ?? ''}
            onChange={(event) => {
              setTyped(event.target.value);
              setAcknowledged(false);
            }}
            disabled={publishing}
            autoComplete="off"
            spellCheck={false}
            className="w-64 font-mono text-sm"
          />
        </SettingsRow>
        <SettingsRow label="Visibility" meta={VISIBILITY_MEANINGS[visibility]}>
          <Segmented
            aria-label="Visibility"
            options={VISIBILITY_CHOICES}
            value={visibility}
            onValueChange={setVisibility}
            // Once it is there, publishing it again changes nothing, its visibility included.
            disabled={publishing || sent}
          />
        </SettingsRow>
        <SettingsRow label="Token" error={errorOf(token)}>
          {token.status === 'success' ? (
            <div className="flex items-center gap-3">
              <SettingsValue>{tokenSourceText(token.data.source)}</SettingsValue>
              {noToken && (
                <Button size="xs" onClick={openTokenSettings}>
                  <KeyRound size={14} strokeWidth={1.7} aria-hidden />
                  Add in Settings
                </Button>
              )}
            </div>
          ) : token.status === 'error' ? (
            <RetryButton onClick={token.reload} />
          ) : (
            <Skeleton shape="pill" className="h-4 w-36" />
          )}
        </SettingsRow>
      </SettingsSection>

      {valid && (
        <ReviewSections
          review={current}
          error={error}
          onRetry={reload}
          acknowledged={acknowledged}
          onAcknowledge={setAcknowledged}
          onPreview={() => setPreviewing(true)}
        />
      )}

      <PublicationsSection publications={publications.data ?? []} />

      {/* Keeps the bar at the bottom when there is little above it. */}
      <div aria-hidden className="min-h-6 flex-1" />
      {/* Pinned over the tab's bottom padding, so nothing scrolls by beneath it. */}
      <div className="sticky -bottom-6 -mx-7 -mb-6 flex flex-wrap items-center justify-end gap-x-5 gap-y-3 border-t border-line-card bg-modal px-7 py-4">
        {waiting && !publishing && (
          <p className="m-0 mr-auto flex min-w-0 items-center gap-2 text-sm text-fg-muted">
            <CircleAlert size={15} strokeWidth={1.8} aria-hidden className="shrink-0" />
            {waiting}
          </p>
        )}
        <Button
          variant="primary"
          size="sm"
          loading={publishing}
          disabled={publishing || sent || loading || waiting !== null || current === null}
          onClick={publish}
        >
          {!publishing && <UploadCloud size={15} strokeWidth={1.7} aria-hidden />}
          {publishing
            ? 'Publishing'
            : sent
              ? 'Published'
              : unfinished
                ? 'Finish publishing'
                : current
                  ? `Publish version ${current.version}`
                  : 'Publish to Hugging Face'}
        </Button>
      </div>

      {current && (
        <Drawer open={previewing} onOpenChange={setPreviewing}>
          <DrawerContent title="Model card" subtitle={`${CARD} · ${current.repository}`}>
            <Markdown text={cardBody(current.card)} />
          </DrawerContent>
        </Drawer>
      )}
    </div>
  );
}

/** The upload on its way: its stage, and the package's bytes sent so far. */
function PublishingSection({
  repository,
  progress,
}: {
  repository: string;
  progress: PublishProgress | null;
}) {
  return (
    <SettingsSection title="Publishing" className="pt-1">
      <SettingsRow
        icon={<StatusMark state="working" label="Publishing" />}
        label={progress ? stageText(progress) : `Checking ${repository} on Hugging Face`}
        meta={progress && progress.totalBytes > 0 ? sentText(progress) : undefined}
      />
      <Progress
        label={`Publishing to ${repository}`}
        value={progress && progress.totalBytes > 0 ? progress.sentBytes / progress.totalBytes : 0}
        {...(progress ? { valueText: sentText(progress) } : {})}
        className="mb-2"
      />
    </SettingsSection>
  );
}

/** A finished publication: the repository's link, its commit, and the command that installs it. */
function PublishedSection({ result }: { result: PublishResult }) {
  const { publication } = result;
  const commit = publication.revision ?? '';
  const command = installCommand(publication.repository, commit);
  return (
    <SettingsSection
      title={result.alreadyPublished ? 'Already published' : 'Published'}
      className="pt-1"
    >
      <SettingsRow
        icon={<StatusMark state="ok" label="Published" />}
        label={`Version ${publication.version} is on Hugging Face`}
        meta={`Commit ${shortCommit(commit)} · ${publication.visibility === 'private' ? 'Private' : 'Public'}`}
      >
        {publication.url && (
          <Button size="xs" onClick={() => openOnHub(publication.url ?? '')}>
            <ExternalLink size={14} strokeWidth={1.7} aria-hidden />
            {bareUrl(publication.url)}
          </Button>
        )}
      </SettingsRow>
      <div className="flex min-h-11 items-center justify-between gap-3 border-t border-line pl-8">
        <code className="min-w-0 truncate font-mono text-xs text-fg-secondary">{command}</code>
        <CopyButton text={command} label="Copy the install command" />
      </div>
      {result.notes.map((note) => (
        <SettingsRow
          key={note}
          density="compact"
          icon={<Info size={16} strokeWidth={1.8} aria-hidden className="text-fg-faint" />}
          label={note}
        />
      ))}
    </SettingsSection>
  );
}

/** The files that would go, with the model card to preview, and what the scan found. */
function ReviewSections({
  review,
  error,
  onRetry,
  acknowledged,
  onAcknowledge,
  onPreview,
}: {
  review: PublicationReview | null;
  error: Error | undefined;
  onRetry: () => void;
  acknowledged: boolean;
  onAcknowledge: (on: boolean) => void;
  onPreview: () => void;
}) {
  if (!review) {
    return error ? (
      <ErrorState
        layout="inline"
        title="Couldn't review what would be published"
        message={error.message}
        onRetry={onRetry}
        className="border-t border-line py-4"
      />
    ) : (
      <div
        aria-busy="true"
        aria-label="Reviewing what would be published"
        className="flex flex-col gap-4 pt-6"
      >
        <Skeleton className="h-3 w-28" />
        {[0, 1, 2].map((row) => (
          <Skeleton key={row} className="h-3.5 w-64" />
        ))}
      </div>
    );
  }
  const weights = review.files.some((file) => file.path.startsWith('adapter/'));
  return (
    <>
      <SettingsSection
        title="Files"
        actions={
          <span className="text-sm text-fg-muted">
            {review.files.length} files · {formatBytes(review.bytes)}
          </span>
        }
      >
        <ul aria-label="Files" className="m-0 flex list-none flex-col p-0">
          {review.files.map((file) => {
            const Icon = file.path.startsWith('adapter/') ? Puzzle : FileText;
            const card = file.path === CARD;
            return (
              <li
                key={file.path}
                className="flex min-h-10 items-center justify-between gap-4 border-t border-line py-1.5"
              >
                <span className="flex min-w-0 items-center gap-3">
                  <Icon
                    size={15}
                    strokeWidth={1.7}
                    aria-hidden
                    className="shrink-0 text-fg-faint"
                  />
                  <span className="truncate font-mono text-sm text-fg-secondary">{file.path}</span>
                  {card && <Badge>Model card</Badge>}
                </span>
                <span className="flex shrink-0 items-center gap-3">
                  <span className="text-sm tabular-nums text-fg-muted">
                    {formatBytes(file.bytes)}
                  </span>
                  {card && (
                    <Button size="xs" variant="ghost" onClick={onPreview}>
                      <Eye size={14} strokeWidth={1.7} aria-hidden />
                      Preview
                    </Button>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      </SettingsSection>

      <SettingsSection title="Scan">
        {review.findings.length > 0 ? (
          <>
            <SettingsRow
              icon={<StatusMark state="attention" />}
              label={`${review.findings.length} ${
                review.findings.length === 1 ? 'line looks' : 'lines look'
              } like a key or a private path`}
            >
              <Checkbox
                checked={acknowledged}
                onCheckedChange={onAcknowledge}
                label="Publish anyway"
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
            label="Nothing in these files looks like a key or a private path"
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
        <SettingsRow
          icon={<Info size={16} strokeWidth={1.8} aria-hidden className="text-fg-faint" />}
          label="It runs with Architect on the computer that installs it, not on Hugging Face"
        />
      </SettingsSection>
    </>
  );
}

const STANDING: Record<Publication['status'], string> = {
  complete: 'Published',
  failed: "Didn't finish",
  staged: "Didn't finish",
  uploading: "Didn't finish",
};

/** The agent's publications, newest first: repository, version, commit and date. */
function PublicationsSection({ publications }: { publications: readonly Publication[] }) {
  if (publications.length === 0) return null;
  return (
    <SettingsSection title="Publications">
      <ul aria-label="Publications" className="m-0 flex list-none flex-col p-0">
        {[...publications].reverse().map((publication) => {
          const complete = publication.status === 'complete';
          const facts = [
            `Version ${publication.version}`,
            complete && publication.revision
              ? `commit ${shortCommit(publication.revision)}`
              : STANDING[publication.status],
            versionDate(publication.updatedAt),
          ];
          return (
            <li
              key={publication.id}
              aria-label={`${publication.repository}, version ${publication.version}`}
            >
              <SettingsRow
                icon={
                  <StatusMark
                    state={complete ? 'ok' : 'blocked'}
                    label={STANDING[publication.status]}
                  />
                }
                label={publication.repository}
                meta={facts.join(' · ')}
              >
                {complete && publication.url && (
                  <IconButton
                    label={`Open ${publication.repository} on Hugging Face`}
                    size="sm"
                    onClick={() => openOnHub(publication.url ?? '')}
                  >
                    <ExternalLink size={15} strokeWidth={1.7} aria-hidden />
                  </IconButton>
                )}
              </SettingsRow>
            </li>
          );
        })}
      </ul>
    </SettingsSection>
  );
}
