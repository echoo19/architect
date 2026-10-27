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

/** Files read as example requests with their answers: task lists by name or format. */
function isTaskFile(path: string): boolean {
  return /\.jsonl$/i.test(path) || /(^|[\\/])tasks?\.csv$/i.test(path);
}

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
  const name = settings.status === 'success' ? mentorName(settings.data.defaultMentor) : null;
  const mentor = name ? `${mentorIntro(name)},` : 'The mentor';

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
          Describe the work in your own words and attach the files it uses. {mentor} reads them,
          asks a few questions, then drafts the job for you to review.
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
        <p className="m-0 text-sm text-fg-secondary text-pretty">
          Attach the files it works from, and a spreadsheet of example requests with the right
          answer to each. {name ?? 'The mentor'} tests the agent on those examples; the more you
          give, the fairer the test.
        </p>
        {files.some(isTaskFile) && (
          <p className="m-0 text-sm text-fg-muted text-pretty">
            Example requests come from {files.filter(isTaskFile).map(fileName).join(' and ')}.
          </p>
        )}
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
      {/* Only offered before anything is written or attached, as a way to start, not a detour. */}
      {!text.trim() && files.length === 0 && (
        <button
          type="button"
          onClick={() => void startFromSample()}
          disabled={creatingSample}
          aria-busy={creatingSample || undefined}
          className="-mt-2 inline-flex items-center gap-2 rounded-xs text-fg-muted transition-colors duration-150 hover:text-fg-secondary disabled:pointer-events-none"
        >
          {creatingSample && <Spinner size={13} />}
          <span>
            No files handy? Open the sample job instead:{' '}
            <span className="text-fg-secondary underline decoration-line-strong underline-offset-4">
              a service desk for a home-services office
            </span>
          </span>
        </button>
      )}
    </div>
  );
}
