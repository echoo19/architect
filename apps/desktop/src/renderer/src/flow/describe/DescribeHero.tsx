import { useState } from 'react';
import { Composer, Heading, IconButton, Spinner } from '@architect/ui';
import { Cloud, Laptop, Paperclip } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { flowApi } from '../../api/client';
import { queryKeys, useSettings } from '../../api/hooks';
import { setQueryData } from '../../api/query';
import { mentorIsLocal, mentorName } from '../../lib/names';
import { attempt } from '../../lib/notify';
import { navigate, paths } from '../../lib/router';
import { AttachedFile, isTaskFile } from './AttachedFile';
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
      ? {
          name: mentorName(settings.data.defaultMentor),
          local: mentorIsLocal(settings.data.defaultMentor),
        }
      : null;

  const attach = async () => {
    const picked = await attempt("Couldn't open the file picker", () =>
      flowApi.pickFiles({
        title: "Add the job's files and example tasks",
        filters: ATTACHABLE,
        multiple: true,
      }),
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

  const empty = !text.trim() && files.length === 0;
  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-8 px-6 pb-[120px] pt-12">
      <Heading as="h1" size="display-sm" className="text-center">
        What should your agent do?
      </Heading>
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
          trailing={
            mentor && (
              <span className="flex items-center gap-1.5 text-sm text-fg-muted">
                {mentor.local ? (
                  <Laptop size={14} strokeWidth={1.6} aria-hidden />
                ) : (
                  <Cloud size={14} strokeWidth={1.6} aria-hidden />
                )}
                {mentor.name}
                <span className="sr-only">
                  {mentor.local
                    ? ', on this computer, reads what you send'
                    : ', in the cloud, reads what you send'}
                </span>
              </span>
            )
          }
        />
        {files.length > 0 && (
          <ul aria-label="Attached files" className="m-0 flex list-none flex-wrap gap-2 p-0">
            {files.map((path) => (
              <li key={path} className="min-w-0">
                <AttachedFile
                  path={path}
                  onRemove={() => setFiles(files.filter((file) => file !== path))}
                />
              </li>
            ))}
          </ul>
        )}
        {!files.some(isTaskFile) && (
          <p className="m-0 text-sm text-fg-muted">
            Include example tasks with their answers, as .jsonl or tasks.csv
          </p>
        )}
      </div>
      {empty && (
        <button
          type="button"
          onClick={() => void startFromSample()}
          disabled={creatingSample}
          aria-busy={creatingSample || undefined}
          className="-mt-3 inline-flex h-8 items-center gap-2 rounded-md px-2 text-fg-muted transition-colors duration-150 hover:text-fg-secondary disabled:pointer-events-none"
        >
          {creatingSample && <Spinner size={13} />}
          Try the sample job
        </button>
      )}
    </div>
  );
}
