import { useEffect, useRef, useState, type ReactNode, type Ref } from 'react';
import { Button, cn, ReplyComposer, Spinner } from '@architect/ui';
import { ArrowRight, Check } from 'lucide-react';
import { flowApi } from '../../api/client';
import { queryKeys, useSettings } from '../../api/hooks';
import { setQueryData } from '../../api/query';
import { ProblemState } from '../../components/ProblemState';
import { mentorName } from '../../lib/names';
import { attempt } from '../../lib/notify';
import { navigate, paths } from '../../lib/router';
import { AttachedFile } from './AttachedFile';
import { lastMentorEntry, type MentorEntry, type UserEntry } from './conversation';
import {
  markDraftSaved,
  resetDraft,
  retryLastMessage,
  sendToMentor,
  useDraftStore,
} from './draft-store';

const DRAFTED = "That's everything I need. I've drafted the job for you to review.";

/** After this long, the waiting line says the mentor is still working. */
const SLOW_MS = 8000;

/** The mentor's clarifying questions, answered by picking an option or typing a reply. */
export function Clarify() {
  const conversation = useDraftStore((state) => state.conversation);
  const settings = useSettings();
  const mentor =
    settings.status === 'success' ? mentorName(settings.data.defaultMentor) : 'The mentor';
  const [reply, setReply] = useState('');
  const [saving, setSaving] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const replyRef = useRef<HTMLInputElement>(null);
  const reviewRef = useRef<HTMLButtonElement>(null);

  const { entries, waiting, failure, sessionId } = conversation;
  const last = lastMentorEntry(conversation);
  const firstReply = entries.find((entry) => entry.kind === 'mentor');

  useEffect(() => {
    const scroller = scrollRef.current;
    scroller?.scrollTo({ top: scroller.scrollHeight });
  }, [entries.length, waiting, failure]);

  // When the mentor answers, put the cursor where the next step is.
  useEffect(() => {
    if (waiting || !last) return;
    if (last.draft) reviewRef.current?.focus();
    else replyRef.current?.focus();
  }, [waiting, last]);

  const sendReply = (text: string) => {
    sendToMentor(text, []);
    setReply('');
  };

  const review = async (entry: MentorEntry) => {
    const { saved } = conversation;
    if (saved?.entryId === entry.id) {
      navigate(paths.define(saved.jobId));
      return;
    }
    const { draft } = entry;
    if (!draft) return;
    setSaving(true);
    const stored = await attempt("Couldn't save the job", () => flowApi.saveJob(draft));
    setSaving(false);
    if (!stored) return;
    setQueryData(queryKeys.job(stored.id), stored);
    markDraftSaved(entry.id, stored.id);
    navigate(paths.define(stored.id));
  };

  return (
    <div className="flex h-full flex-col">
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-12">
        <ol
          aria-label="Conversation with the mentor"
          className="m-0 mx-auto flex max-w-[720px] list-none flex-col gap-7 p-0"
        >
          {entries.map((entry) =>
            entry.kind === 'user' ? (
              !entry.viaOption && (
                <li key={entry.id} className="flex flex-col">
                  <UserMessage entry={entry} />
                </li>
              )
            ) : (
              <li key={entry.id} className="flex flex-col">
                <MentorMessage
                  entry={entry}
                  speaker={entry === firstReply ? mentor : undefined}
                  current={entry === last && !waiting}
                  onPick={(option) => sendToMentor(option, [], option)}
                  review={
                    entry === last && entry.draft
                      ? { saving, buttonRef: reviewRef, onReview: () => void review(entry) }
                      : undefined
                  }
                />
              </li>
            ),
          )}
          {waiting && (
            <li>
              <Waiting
                since={waiting.startedAt}
                text={
                  sessionId
                    ? `${mentor} is thinking`
                    : waiting.files.length > 0
                      ? `${mentor} is reading your description and ${plural(waiting.files.length, 'file')}`
                      : `${mentor} is reading your description`
                }
                slowText="Still working. This can take a minute."
              />
            </li>
          )}
          {failure && (
            <li className="flex flex-col gap-3">
              <ProblemState
                layout="inline"
                error={failure.error}
                title={`${mentor} couldn't answer`}
                onRetry={retryLastMessage}
              />
              {!sessionId && (
                <Button
                  size="sm"
                  className="self-start"
                  onClick={() => resetDraft({ keepFirstMessage: true })}
                >
                  Edit the description
                </Button>
              )}
            </li>
          )}
        </ol>
      </div>
      {sessionId && (
        <div className="px-6 pb-6">
          <ReplyComposer
            className="mx-auto"
            label="Reply"
            placeholder="Reply"
            value={reply}
            onValueChange={setReply}
            onSubmit={sendReply}
            disabled={waiting !== null}
            inputRef={replyRef}
          />
        </div>
      )}
    </div>
  );
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function UserMessage({ entry }: { entry: UserEntry }) {
  return (
    <div className="flex max-w-[540px] flex-col items-end gap-2.5 self-end">
      <p className="m-0 whitespace-pre-wrap rounded-3xl bg-selected px-4 py-3 text-md text-pretty">
        {entry.text}
      </p>
      {entry.files.length > 0 && (
        <ul aria-label="Files sent" className="m-0 flex list-none flex-wrap justify-end gap-2 p-0">
          {entry.files.map((path) => (
            <li key={path} className="min-w-0">
              <AttachedFile path={path} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StepLine({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="flex h-[22px] items-center gap-2 text-sm text-fg-muted">
      {icon}
      <span>{children}</span>
    </div>
  );
}

interface ReviewAction {
  saving: boolean;
  buttonRef: Ref<HTMLButtonElement>;
  onReview: () => void;
}

function MentorMessage({
  entry,
  speaker,
  current,
  onPick,
  review,
}: {
  entry: MentorEntry;
  /** Who is talking, on the first reply only: "Spark". */
  speaker: string | undefined;
  /** The latest message, still waiting for an answer. */
  current: boolean;
  onPick: (option: string) => void;
  review: ReviewAction | undefined;
}) {
  const message = entry.message.trim();
  const showMessage = message.length > 0 && !(entry.draft && message === DRAFTED);
  return (
    <div className={cn('flex flex-col text-md', entry.options.length > 0 ? 'gap-4' : 'gap-2.5')}>
      {speaker && <span className="text-sm font-medium text-mentor">{speaker}</span>}
      {entry.readFiles > 0 && (
        <StepLine icon={<Check size={14} strokeWidth={1.8} aria-hidden />}>
          Read {plural(entry.readFiles, 'file')}
        </StepLine>
      )}
      {showMessage && <p className="m-0 whitespace-pre-wrap text-pretty">{message}</p>}
      {entry.options.length > 0 && (
        <div role="group" aria-label="Answers" className="flex flex-wrap gap-2">
          {entry.options.map((option) =>
            current ? (
              <Button
                key={option}
                size="md"
                onClick={() => onPick(option)}
                className="rounded-lg bg-card px-4 text-fg-secondary hover:text-fg"
              >
                {option}
              </Button>
            ) : (
              <span
                key={option}
                aria-current={entry.chosen === option ? 'true' : undefined}
                className={cn(
                  'inline-flex h-10 items-center rounded-lg border px-4',
                  entry.chosen === option
                    ? 'border-fg bg-selected text-fg'
                    : 'border-line-control bg-card text-fg-muted',
                )}
              >
                {option}
              </span>
            ),
          )}
        </div>
      )}
      {entry.draft && (
        <div className="flex flex-col gap-4">
          <p className="m-0">{DRAFTED}</p>
          {review && (
            <Button
              ref={review.buttonRef}
              variant="primary"
              loading={review.saving}
              onClick={review.onReview}
              className="self-start"
            >
              Review the job
              <ArrowRight size={16} strokeWidth={2} aria-hidden />
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function Waiting({ since, text, slowText }: { since: number; text: string; slowText: string }) {
  const [slow, setSlow] = useState(() => Date.now() - since >= SLOW_MS);
  useEffect(() => {
    if (slow) return;
    const timer = window.setTimeout(() => setSlow(true), Math.max(0, since + SLOW_MS - Date.now()));
    return () => window.clearTimeout(timer);
  }, [since, slow]);
  return (
    <div role="status" className="flex h-[22px] items-center gap-2 text-sm text-fg-muted">
      <Spinner tone="mentor" size={14} />
      <span>{slow ? slowText : text}</span>
    </div>
  );
}
