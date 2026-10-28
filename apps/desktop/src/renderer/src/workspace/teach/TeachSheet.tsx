import { useId, useState, type ReactNode } from 'react';
import type { Correction, GraduateSummary, WorkspaceMessage } from '@architect/shared';
import {
  Button,
  DrawerContent,
  EmptyState,
  ErrorState,
  Field,
  Heading,
  Skeleton,
  StatusDot,
  StatusMark,
  Textarea,
  ToggleChip,
} from '@architect/ui';
import { File, LockKeyhole, Send } from 'lucide-react';
import { useVersions } from '../../api/graduates';
import { setQueryData, toError } from '../../api/query';
import {
  refreshTeaching,
  teachApi,
  teachKeys,
  useCorrections,
  useFreshTeaching,
  useTeachingOverview,
} from '../../api/teaching';
import { formatUsd } from '../../lib/format';
import { shortModelName } from '../../lib/names';
import { useAgentSettingsUi } from '../settings/agentSettingsUi';
import { evidenceText, lessonCount, proposeFailure, shortRequest } from './lessons';
import { ProposalActions, ProposalView } from './Proposal';

export interface TeachSheetProps {
  agent: GraduateSummary;
  /** The settled reply the person flagged. */
  reply: WorkspaceMessage;
  /** What the person asked, which the reply answered. */
  request: string;
  onClose: () => void;
}

type Stage =
  | { kind: 'write' }
  | { kind: 'sending' }
  | { kind: 'proposed'; correction: Correction }
  | { kind: 'done'; correction: Correction };

/**
 * Teach this, opened from a reply's flag: the person says what was wrong and what it should
 * have done, with evidence if they have it. One line says what leaves this computer, and nothing
 * does until they send it. The mentor's proposed lesson comes back, and the person adds it to
 * the teaching queue, applies an instruction as a new version, or discards it. The version chats
 * run on never changes here. Render it inside an open Drawer.
 */
export function TeachSheet({ agent, reply, request, onClose }: TeachSheetProps) {
  const overview = useTeachingOverview(agent.id);
  useFreshTeaching(agent.id);
  const [stage, setStage] = useState<Stage>({ kind: 'write' });
  const [wrong, setWrong] = useState('');
  const [wanted, setWanted] = useState('');
  const [files, setFiles] = useState<string[]>([]);
  const [rows, setRows] = useState('');
  const [error, setError] = useState<string | null>(null);
  const versions = useVersions(agent.id);
  const corrections = useCorrections(agent.id);
  const showSettings = useAgentSettingsUi((state) => state.show);

  const list = versions.data;
  const wrote =
    list?.find((version) => version.version === reply.graduateVersion) ??
    list?.find((version) => version.active);
  const jobFiles = wrote?.manifest.contract.inputs.files.map((file) => file.name) ?? [];
  const nextVersion = list ? Math.max(0, ...list.map((version) => version.version)) + 1 : null;
  const active = list?.find((version) => version.active)?.version ?? agent.activeVersion;
  const subtitle = `Reply to "${shortRequest(request)}"`;
  const ready = overview.data;
  const mentor = shortModelName(ready?.mentor ?? 'Spark');

  const send = async () => {
    if (!ready) return;
    setStage({ kind: 'sending' });
    setError(null);
    try {
      // The person's send is the job's leave to share flagged answers, each one only like this.
      if (!ready.sharesCorrections) {
        setQueryData(teachKeys.overview(agent.id), await teachApi.shareCorrections(agent.id, true));
      }
      const evidence = evidenceText(files, rows);
      const correction = await teachApi.propose(reply.chatId, reply.id, {
        wrong: wrong.trim(),
        ...(wanted.trim() === '' ? {} : { wanted: wanted.trim() }),
        ...(evidence === undefined ? {} : { evidence }),
        consent: true,
      });
      void refreshTeaching(agent.id);
      setStage({ kind: 'proposed', correction });
    } catch (failure) {
      setError(proposeFailure(toError(failure).message, mentor));
      setStage({ kind: 'write' });
    }
  };

  const openTeaching = () => {
    onClose();
    showSettings(agent.id, 'teaching');
  };

  let body: ReactNode;
  let footer: ReactNode;
  if (overview.status === 'error' && !ready) {
    body = (
      <ErrorState
        layout="inline"
        title="Couldn't check whether it can be taught here"
        message={overview.error.message}
        onRetry={overview.reload}
      />
    );
    footer = <CloseButton onClose={onClose} />;
  } else if (!ready) {
    body = <SheetSkeleton />;
  } else if (ready.unavailable) {
    body = (
      <EmptyState
        icon={<LockKeyhole aria-hidden />}
        title={`${agent.name} can't be taught here`}
        description={ready.unavailable.message}
        className="min-h-[50vh]"
      />
    );
    footer = <CloseButton onClose={onClose} />;
  } else if (stage.kind === 'proposed') {
    body = (
      <ProposalView correction={stage.correction} mentor={mentor} capUsd={ready.correctionCapUsd} />
    );
    footer = (
      <ProposalActions
        graduateId={agent.id}
        correction={stage.correction}
        nextVersion={nextVersion}
        onSettled={(settled) => {
          if (settled.status === 'discarded') onClose();
          else setStage({ kind: 'done', correction: settled });
        }}
        onEdit={() => setStage({ kind: 'write' })}
      />
    );
  } else if (stage.kind === 'done') {
    const queued = (corrections.data ?? []).filter((item) => item.status === 'queued').length;
    body =
      stage.correction.status === 'applied' ? (
        <Settled title={`Made version ${stage.correction.candidateVersion ?? ''}`.trim()}>
          <span>Not evaluated yet.</span>
          {active !== null && (
            <span>
              Version {active} keeps answering until you promote version{' '}
              {stage.correction.candidateVersion}.
            </span>
          )}
        </Settled>
      ) : (
        <Settled title="Added to the teaching queue">
          <span>
            {lessonCount(Math.max(queued, 1))} {queued === 1 ? 'waits' : 'wait'} for Improve agent.
          </span>
        </Settled>
      );
    footer = (
      <>
        <Button size="md" onClick={onClose}>
          Done
        </Button>
        <Button size="md" variant="primary" onClick={openTeaching}>
          Open Teaching
        </Button>
      </>
    );
  } else {
    const sending = stage.kind === 'sending';
    body = (
      <CorrectionForm
        reply={reply.text}
        wrong={wrong}
        wanted={wanted}
        files={files}
        rows={rows}
        jobFiles={jobFiles}
        disabled={sending}
        error={error}
        onWrong={setWrong}
        onWanted={setWanted}
        onFiles={setFiles}
        onRows={setRows}
      />
    );
    // What leaves this computer, beside the one button that sends it.
    footer = (
      <>
        <div className="mr-auto flex items-start gap-2.5 text-sm">
          <StatusDot tone="mentor" className="mt-[7px]" />
          <p className="m-0 flex flex-col">
            <span className="text-fg-secondary">
              {mentor} reads this exchange to propose a lesson.
            </span>
            <span className="font-mono text-fg-muted">
              Up to {formatUsd(ready.correctionCapUsd)}
            </span>
          </p>
        </div>
        <Button
          size="md"
          variant="primary"
          loading={sending}
          disabled={wrong.trim() === ''}
          onClick={() => void send()}
        >
          {!sending && <Send size={14} strokeWidth={1.8} aria-hidden />}
          Send to {mentor}
        </Button>
      </>
    );
  }

  return (
    <DrawerContent title="Teach this" subtitle={subtitle} footer={footer}>
      {body}
    </DrawerContent>
  );
}

function CloseButton({ onClose }: { onClose: () => void }) {
  return (
    <Button size="md" onClick={onClose}>
      Close
    </Button>
  );
}

function Settled({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div role="status" className="flex flex-col items-start gap-4 pt-2">
      <StatusMark state="ok" size={24} />
      <div className="flex flex-col gap-1.5">
        <Heading as="h3" size="title">
          {title}
        </Heading>
        <p className="m-0 flex flex-col text-fg-secondary">{children}</p>
      </div>
    </div>
  );
}

interface CorrectionFormProps {
  reply: string;
  wrong: string;
  wanted: string;
  files: string[];
  rows: string;
  /** The files the agent's job lists, any of which can be named as evidence. */
  jobFiles: string[];
  disabled: boolean;
  error: string | null;
  onWrong: (text: string) => void;
  onWanted: (text: string) => void;
  onFiles: (files: string[]) => void;
  onRows: (text: string) => void;
}

/** What was wrong, what it should have done, and optional evidence: files or rows. */
function CorrectionForm({
  reply,
  wrong,
  wanted,
  files,
  rows,
  jobFiles,
  disabled,
  error,
  onWrong,
  onWanted,
  onFiles,
  onRows,
}: CorrectionFormProps) {
  const id = useId();
  return (
    <div className="flex flex-col gap-6">
      {reply.trim() !== '' && (
        <blockquote className="m-0 line-clamp-3 border-l-2 border-line-control pl-4 text-fg-secondary">
          {reply}
        </blockquote>
      )}
      <Field label="What was wrong" htmlFor={`${id}-wrong`}>
        <Textarea
          id={`${id}-wrong`}
          value={wrong}
          maxLength={4000}
          rows={3}
          disabled={disabled}
          autoFocus
          onChange={(event) => onWrong(event.target.value)}
        />
      </Field>
      <Field label="What it should have done" htmlFor={`${id}-wanted`}>
        <Textarea
          id={`${id}-wanted`}
          value={wanted}
          maxLength={8000}
          rows={3}
          disabled={disabled}
          placeholder="Or the right result"
          onChange={(event) => onWanted(event.target.value)}
        />
      </Field>
      <Field label="Evidence" hint="Optional" htmlFor={`${id}-rows`}>
        {jobFiles.length > 0 && (
          <div role="group" aria-label="Files it should have used" className="flex flex-wrap gap-2">
            {jobFiles.map((file) => (
              <ToggleChip
                key={file}
                pressed={files.includes(file)}
                disabled={disabled}
                icon={<File size={14} strokeWidth={1.6} />}
                onPressedChange={(on) =>
                  onFiles(on ? [...files, file] : files.filter((chosen) => chosen !== file))
                }
              >
                {file}
              </ToggleChip>
            ))}
          </div>
        )}
        <Textarea
          id={`${id}-rows`}
          value={rows}
          maxLength={3500}
          rows={3}
          disabled={disabled}
          placeholder="Or paste the rows it should have used"
          className="font-mono text-sm"
          onChange={(event) => onRows(event.target.value)}
        />
      </Field>
      {error && <ErrorState layout="inline" title="Couldn't propose a lesson" message={error} />}
    </div>
  );
}

function SheetSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading" className="flex flex-col gap-6">
      <Skeleton className="h-12 w-full" />
      {[0, 1].map((field) => (
        <div key={field} className="flex flex-col gap-2">
          <Skeleton className="h-3.5 w-36" />
          <Skeleton className="h-24 w-full rounded-md" />
        </div>
      ))}
    </div>
  );
}
