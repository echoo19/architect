import { useState } from 'react';
import {
  organizationNoun,
  type Job,
  type RecordingQuote,
  type TaskPlan,
  type Transcript,
} from '@architect/shared';
import {
  Button,
  Checkbox,
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@architect/ui';
import { AudioLines, CircleAlert, Mic, Send, Wallet } from 'lucide-react';
import { flowApi } from '../../api/client';
import { queryKeys } from '../../api/hooks';
import { setQueryData } from '../../api/query';
import { attempt } from '../../lib/notify';
import { formatUsd } from '../../lib/format';

/*
 * A taught organization's recordings, read by the study as text (decision 087): an action that
 * adds them, the cost and where they go before anything is sent, and the transcripts so far.
 */

/** Cost in dollars, legible when it is a fraction of a cent. */
function cost(usd: number): string {
  if (usd === 0) return '$0';
  return usd < 0.01 ? 'under $0.01' : formatUsd(Math.round(usd * 100) / 100);
}

/** A length in seconds as m:ss. */
function length(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export function Recordings({ job, plan, mentor }: { job: Job; plan: TaskPlan; mentor: string }) {
  const { recordings } = plan;
  const [quote, setQuote] = useState<RecordingQuote | null>(null);
  const [busy, setBusy] = useState(false);
  if (recordings === undefined) return null;
  const taught = (job.organizations ?? []).filter((org) => org.role === 'train');
  const names = new Map(taught.map((org) => [org.id, org.name]));
  const keep = (next: TaskPlan) => setQueryData(queryKeys.taskPlan(job.id), next);

  const add = async (org: string) => {
    const paths = await attempt("Couldn't open the recordings", () =>
      flowApi.pickFiles({
        title: `Add ${names.get(org) ?? 'the organization'}'s recordings`,
        multiple: true,
        filters: [
          { name: 'WAV recordings', extensions: ['wav'] },
          {
            name: 'Other recordings and videos',
            extensions: ['mp3', 'm4a', 'aac', 'ogg', 'flac', 'mp4', 'mov', 'webm'],
          },
        ],
      }),
    );
    if (paths === undefined || paths.length === 0) return;
    const priced = await attempt("Couldn't read the recordings", () =>
      flowApi.quoteRecordings(job.id, org, paths),
    );
    if (priced) setQuote(priced);
  };

  const share = async (allowed: boolean) => {
    const next = await attempt("Couldn't change the setting", () =>
      flowApi.shareRecordings(job.id, allowed),
    );
    if (next) keep(next);
  };

  const transcribe = async () => {
    if (quote === null) return;
    setBusy(true);
    const next = await attempt("Couldn't transcribe the recordings", () =>
      flowApi.transcribe(job.id, {
        org: quote.org,
        paths: quote.files.map((file) => file.path),
        consent: true,
      }),
    );
    setBusy(false);
    if (!next) return;
    keep(next);
    setQuote(null);
  };

  const [only] = taught;
  const label = (
    <>
      <Mic size={14} strokeWidth={1.8} aria-hidden />
      Add recordings
    </>
  );
  return (
    <section
      aria-label="Recordings"
      className="mt-4 flex flex-col gap-3 rounded-card surface-card px-6 py-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="m-0 flex max-w-[560px] items-start gap-2.5 text-pretty">
          <AudioLines size={16} strokeWidth={1.8} className="mt-0.5 shrink-0" aria-hidden />
          {recordings.transcripts.length === 0
            ? `Calls, meetings and lesson walkthroughs can be studied too, once Muse Voice writes them down.`
            : `${mentor} studies these transcripts with each ${organizationNoun(job)}'s files.`}
        </p>
        {taught.length === 1 && only !== undefined ? (
          <Button size="sm" onClick={() => void add(only.id)}>
            {label}
          </Button>
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm">{label}</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {taught.map((org) => (
                <DropdownMenuItem key={org.id} onSelect={() => void add(org.id)}>
                  {org.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {recordings.transcripts.length > 0 && (
        <ul aria-label="Transcripts" className="m-0 flex list-none flex-col p-0">
          {recordings.transcripts.map((transcript) => (
            <TranscriptRow
              key={transcript.file + transcript.org}
              transcript={transcript}
              names={names}
            />
          ))}
        </ul>
      )}

      <Dialog open={quote !== null} onOpenChange={(open) => !open && setQuote(null)}>
        {quote !== null && (
          <DialogContent
            title={`Transcribe ${quote.files.length === 1 ? 'a recording' : `${quote.files.length} recordings`}`}
          >
            <div className="flex flex-col gap-4 px-6 pt-4">
              <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                {quote.files.map((file) => (
                  <li key={file.path} className="flex items-center justify-between gap-4 text-ui">
                    <span className="flex min-w-0 items-center gap-2.5">
                      <AudioLines size={15} strokeWidth={1.8} className="shrink-0" aria-hidden />
                      <span className="truncate">{file.name}</span>
                    </span>
                    <span className="shrink-0 tabular-nums">
                      {file.done
                        ? 'Already transcribed'
                        : `${length(file.seconds)} · ${cost(file.usd)}`}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="m-0 flex items-start gap-3 text-ui text-pretty">
                <Send size={15} strokeWidth={1.8} className="mt-0.5 shrink-0" aria-hidden />
                {`These recordings are sent to Meta to be transcribed by Muse Voice. The transcripts become ${names.get(quote.org) ?? 'the organization'}'s files, which ${mentor} reads when it studies.`}
              </p>
              <p className="m-0 flex items-start gap-3 text-ui text-pretty">
                <Wallet size={15} strokeWidth={1.8} className="mt-0.5 shrink-0" aria-hidden />
                {`${cost(quote.usd)} of Meta credit, at $0.18 an hour of audio. One batch may cost at most ${formatUsd(quote.capUsd)}.`}
              </p>
              {quote.usd > quote.capUsd && (
                <p role="alert" className="m-0 flex items-start gap-3 text-ui text-danger">
                  <CircleAlert
                    size={15}
                    strokeWidth={1.8}
                    className="mt-0.5 shrink-0"
                    aria-hidden
                  />
                  That is more than one batch may cost. Add fewer recordings at a time.
                </p>
              )}
              <Checkbox
                checked={recordings.allowed}
                onCheckedChange={(allowed) => void share(allowed)}
                label="Let this job send recordings to Meta for transcription"
              />
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button size="md">Cancel</Button>
              </DialogClose>
              <Button
                variant="primary"
                size="md"
                loading={busy}
                disabled={!recordings.allowed || quote.usd > quote.capUsd}
                onClick={() => void transcribe()}
              >
                Send and transcribe
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </section>
  );
}

function TranscriptRow({
  transcript,
  names,
}: {
  transcript: Transcript;
  names: ReadonlyMap<string, string>;
}) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-line py-3 text-ui">
      <span className="flex min-w-0 items-center gap-2.5">
        <AudioLines size={15} strokeWidth={1.8} className="shrink-0" aria-hidden />
        <span className="truncate font-medium">{transcript.source}</span>
        <span className="truncate">{names.get(transcript.org) ?? transcript.org}</span>
      </span>
      <span className="shrink-0 tabular-nums">
        {`${length(transcript.seconds)} · ${cost(transcript.usd)}`}
      </span>
    </li>
  );
}
