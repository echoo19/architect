import { useState } from 'react';
import type { DraftTurn } from '@architect/shared';
import { Button, Composer, ErrorState, Heading, IconButton } from '@architect/ui';
import { FileText, Paperclip } from 'lucide-react';
import { architect } from '../api/client';
import { toError } from '../api/query';
import { attempt } from '../lib/notify';
import { navigate, paths } from '../lib/router';
import { FlowShell } from '../shell/FlowShell';

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

/** Step one of a new agent: the job in the user's own words, plus any files it works with. */
export function DescribeScreen() {
  const [text, setText] = useState('');
  const [files, setFiles] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<Error | null>(null);
  const [turn, setTurn] = useState<DraftTurn | null>(null);

  const pickFiles = async () => {
    const picked = await attempt("Couldn't open the file picker", () =>
      architect().files.pick({ title: 'Add files for the job', multiple: true }),
    );
    if (picked) setFiles((current) => [...new Set([...current, ...picked])]);
  };

  const follow = (next: DraftTurn) => {
    if (next.draft) navigate(paths.define(next.draft.id));
    else setTurn(next);
  };

  const submit = async (message: string) => {
    setSending(true);
    setFailure(null);
    try {
      follow(
        turn
          ? await architect().jobs.draftReply(turn.sessionId, message)
          : await architect().jobs.draftStart(message, files),
      );
      setText('');
    } catch (error) {
      setFailure(toError(error));
    } finally {
      setSending(false);
    }
  };

  return (
    <FlowShell title="New agent" step="Describe">
      <div className="flex min-h-full flex-col items-center justify-center gap-8 px-6 pb-[120px] pt-12">
        <Heading as="h1" size="display-sm" className="text-center">
          What should your agent do?
        </Heading>
        {turn && (
          <p className="m-0 max-w-[680px] whitespace-pre-wrap text-center text-lg text-fg-soft text-pretty">
            {turn.message}
          </p>
        )}
        {turn && turn.options.length > 0 && (
          <div className="flex flex-wrap justify-center gap-2">
            {turn.options.map((option) => (
              <Button key={option} size="md" disabled={sending} onClick={() => void submit(option)}>
                {option}
              </Button>
            ))}
          </div>
        )}
        <Composer
          size="hero"
          label={turn ? 'Reply' : 'Describe the job'}
          placeholder={turn ? 'Reply' : 'Describe the job in your own words'}
          value={text}
          onValueChange={setText}
          onSubmit={(message) => void submit(message)}
          disabled={sending}
          autoFocus
          leading={
            !turn && (
              <IconButton label="Attach files" onClick={() => void pickFiles()}>
                <Paperclip size={18} strokeWidth={1.6} aria-hidden />
              </IconButton>
            )
          }
        />
        {files.length > 0 && !turn && (
          <ul
            aria-label="Attached files"
            className="m-0 flex list-none flex-wrap justify-center gap-2 p-0"
          >
            {files.map((path) => (
              <li
                key={path}
                className="flex h-8 items-center gap-2 rounded-md border border-line-control bg-card px-3 text-sm text-fg-secondary"
              >
                <FileText size={14} strokeWidth={1.6} aria-hidden />
                {fileName(path)}
              </li>
            ))}
          </ul>
        )}
        {failure && (
          <ErrorState
            layout="inline"
            title="Couldn't start drafting the job"
            message={failure.message}
            className="w-full max-w-[680px]"
          />
        )}
      </div>
    </FlowShell>
  );
}
