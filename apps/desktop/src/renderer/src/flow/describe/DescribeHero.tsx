import { useState } from 'react';
import { Composer, FileChip, Heading, IconButton, Spinner } from '@architect/ui';
import { Paperclip } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { flowApi } from '../../api/client';
import { queryKeys, useSettings } from '../../api/hooks';
import { setQueryData } from '../../api/query';
import { mentorIntro, mentorName } from '../../lib/names';
import { attempt } from '../../lib/notify';
import { navigate, paths } from '../../lib/router';
import { fileName } from '../format';
import { sendToMentor, useDraftStore } from './draft-store';

/** Data the agent works with, and example tasks with their answers. */
const ATTACHABLE = [
  { name: 'Data and task files', extensions: ['csv', 'xlsx', 'txt', 'md', 'jsonl'] },
  { name: 'Data files', extensions: ['csv', 'xlsx', 'txt', 'md'] },
  { name: 'Task files', extensions: ['jsonl', 'csv'] },
];

/** The first step of a new agent: the job in the user's own words, plus its files. */
export function DescribeHero() {
  const { text, files, setText, setFiles } = useDraftStore(
    useShallow((state) => ({
      text: state.text,
      files: state.files,
      setText: state.setText,
      setFiles: state.setFiles,
    })),
  );
  const [creatingSample, setCreatingSample] = useState(false);
  const settings = useSettings();
  const mentor =
    settings.status === 'success'
      ? `${mentorIntro(mentorName(settings.data.defaultMentor))},`
      : 'The mentor';

  const attach = async () => {
    const picked = await attempt("Couldn't open the file picker", () =>
      flowApi.pickFiles({ title: 'Add files for the job', filters: ATTACHABLE, multiple: true }),
    );
    if (picked) setFiles([...new Set([...files, ...picked])]);
  };

  const send = (description: string) => {
    sendToMentor(description, files);
    setText('');
    setFiles([]);
  };

  const startFromSample = async () => {
    setCreatingSample(true);
    const job = await attempt("Couldn't create the sample job", () => flowApi.createSample());
    setCreatingSample(false);
    if (!job) return;
    setQueryData(queryKeys.job(job.id), job);
    navigate(paths.define(job.id));
  };

  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-8 px-6 pb-[120px] pt-12">
      <div className="flex max-w-[600px] flex-col items-center gap-3 text-center">
        <Heading as="h1" size="display-sm">
          What should your agent do?
        </Heading>
        <p className="m-0 text-lg text-fg-secondary text-pretty">
          Describe the work in your own words and attach the files it uses. {mentor} will ask a few
          questions, then draft the job for you to review.
        </p>
      </div>
      <div className="flex w-full max-w-[680px] flex-col gap-3">
        <Composer
          size="hero"
          label="Describe the job"
          placeholder="Describe the job in your own words"
          value={text}
          onValueChange={setText}
          onSubmit={send}
          autoFocus
          leading={
            <IconButton label="Attach files" onClick={() => void attach()}>
              <Paperclip size={18} strokeWidth={1.6} aria-hidden />
            </IconButton>
          }
        />
        {files.length > 0 && (
          <ul aria-label="Attached files" className="m-0 flex list-none flex-wrap gap-2 p-0">
            {files.map((path) => (
              <li key={path} className="min-w-0">
                <FileChip
                  name={fileName(path)}
                  onRemove={() => setFiles(files.filter((file) => file !== path))}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
      <button
        type="button"
        onClick={() => void startFromSample()}
        disabled={creatingSample}
        aria-busy={creatingSample || undefined}
        className="-mt-2 inline-flex items-center gap-2 rounded-xs text-fg-muted transition-colors duration-150 hover:text-fg-secondary disabled:pointer-events-none"
      >
        {creatingSample && <Spinner size={13} />}
        <span>
          Or start from the sample:{' '}
          <span className="text-fg-secondary underline decoration-line-strong underline-offset-4">
            a service desk for a home-services office
          </span>
        </span>
      </button>
    </div>
  );
}
