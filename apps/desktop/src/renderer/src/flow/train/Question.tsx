import { useState, type KeyboardEvent } from 'react';
import type { Intervention, Round } from '@architect/shared';
import { Button, Checkbox, Collapse, Skeleton, Textarea } from '@architect/ui';
import { architect } from '../../api/client';
import { ProblemState } from '../../components/ProblemState';
import { attempt } from '../../lib/notify';
import type { ModelNames } from './phase';
import type { QuestionView } from './questions';

/** The most an answer may hold, as the engine's route allows. */
const MAX_ANSWER = 4000;

/**
 * The mentor's question for the person, asked in the round it came up in and answered there, in
 * the same panel as the rest of the round: no dialog takes over the screen. An answer is the
 * person's own words, and may say it changes what counts as success, which ends the run, since the
 * final test belongs to the job as it was. The answer goes through the engine's own route; the
 * round shows it, and what the mentor did with it, once the engine has taken it up.
 */
export function Question({
  runId,
  round,
  view,
  names,
}: {
  runId: string;
  round: Round;
  view: QuestionView;
  names: ModelNames;
}) {
  if (view.state === 'loading') {
    return (
      <div
        aria-busy="true"
        aria-label={`${names.mentor}'s question`}
        className="grid grid-cols-[80px_minmax(0,1fr)] gap-x-4"
      >
        <span className="text-mentor">{names.mentor}</span>
        <div className="flex flex-col gap-2">
          <Skeleton className="h-4 w-4/5" />
          <Skeleton className="h-4 w-3/5" />
        </div>
      </div>
    );
  }
  if (view.state === 'error') {
    return (
      <ProblemState
        layout="inline"
        error={view.error}
        title={`Couldn't read ${names.mentor}'s question`}
        onRetry={view.reload}
      />
    );
  }
  return <Asking runId={runId} round={round} intervention={view.intervention} names={names} />;
}

function Asking({
  runId,
  round,
  intervention,
  names,
}: {
  runId: string;
  round: Round;
  intervention: Intervention;
  names: ModelNames;
}) {
  const [text, setText] = useState('');
  const [changes, setChanges] = useState(false);
  const [sending, setSending] = useState(false);
  const ready = text.trim().length > 0;

  const send = async () => {
    if (!ready || sending) return;
    setSending(true);
    const sent = await attempt("Couldn't send your answer", async () => {
      await architect().mentoring.answer(runId, round.index, {
        text: text.trim(),
        changesCriteria: changes,
      });
      return true;
    });
    // Sent, the round moves on and this goes with it; not sent, the answer stays to try again.
    if (sent === undefined) setSending(false);
  };

  const submitOnEnter = (event: KeyboardEvent) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      void send();
    }
  };

  return (
    <form
      aria-label={`${names.mentor}'s question`}
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
      className="grid grid-cols-[80px_minmax(0,1fr)] gap-x-4 gap-y-4"
    >
      <span className="text-mentor">{names.mentor}</span>
      <p className="m-0 font-medium text-pretty">{intervention.question}</p>
      <div className="col-start-2 flex max-w-[640px] flex-col gap-4">
        <Textarea
          aria-label="Your answer"
          placeholder="Your answer"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={submitOnEnter}
          maxLength={MAX_ANSWER}
          rows={3}
          disabled={sending}
          className="min-h-[88px]"
        />
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
          <Checkbox
            checked={changes}
            onCheckedChange={setChanges}
            disabled={sending}
            label="This changes what counts as success"
          />
          <Button type="submit" variant="primary" size="md" loading={sending} disabled={!ready}>
            {changes ? 'Send answer and stop this run' : 'Send answer'}
          </Button>
        </div>
        <Collapse open={changes}>
          <p className="m-0 text-small text-pretty">
            This run stops here. Its final test belongs to the job as it was, so you would train
            again on the changed job.
          </p>
        </Collapse>
      </div>
    </form>
  );
}
