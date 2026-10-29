import { DRAFTING_LIMITS } from '@architect/shared';
import { Composer, Heading, IconButton, Tooltip } from '@architect/ui';
import { Cloud, FileText, Laptop, Paperclip } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { flowApi } from '../../api/client';
import { useSettings } from '../../api/hooks';
import { ReadyMadeAgentButton } from '../../import/ReadyMadeAgentButton';
import { mentorIsLocal, mentorName } from '../../lib/names';
import { attempt } from '../../lib/notify';
import { AttachedFile } from './AttachedFile';
import { sendToMentor, useDraftStore } from './draft-store';
import { SampleJobButton } from './SampleJobButton';

/** What drafting reads and the least it needs, said before anything is attached (decision 061). */
const FILES_NEEDED = `CSV, text and Markdown files, with at least ${DRAFTING_LIMITS.minTasks} rows of records in all`;

/** Data the agent works with, and example tasks with their answers. */
const ATTACHABLE = [
  { name: 'Data and task files', extensions: ['csv', 'txt', 'md', 'jsonl'] },
  { name: 'Data files', extensions: ['csv', 'txt', 'md'] },
  { name: 'Task files', extensions: ['jsonl'] },
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
            <Tooltip
              content={`Add the job's files as CSV, text or Markdown (a text is read whole, up to ${DRAFTING_LIMITS.maxTextChars.toLocaleString('en-US')} characters), and example tasks with their answers as a .jsonl file`}
              side="bottom"
            >
              <IconButton label="Attach files" onClick={() => void attach()}>
                <Paperclip size={18} strokeWidth={1.6} aria-hidden />
              </IconButton>
            </Tooltip>
          }
          trailing={
            mentor && (
              <span className="flex items-center gap-1.5 text-sm text-fg-muted">
                {mentor.local ? (
                  <Laptop size={14} strokeWidth={1.6} aria-hidden />
                ) : (
                  <Cloud size={14} strokeWidth={1.6} aria-hidden />
                )}
                Teacher: {mentor.name}
                <span className="sr-only">
                  {mentor.local
                    ? ', on this computer, reads what you send'
                    : ', in the cloud, reads what you send'}
                </span>
              </span>
            )
          }
        />
        {files.length > 0 ? (
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
        ) : (
          <p className="m-0 flex items-center justify-center gap-2 text-sm text-fg-muted">
            <FileText size={14} strokeWidth={1.6} aria-hidden />
            {FILES_NEEDED}
          </p>
        )}
      </div>
      {empty && (
        <div className="-mt-3 flex flex-wrap items-center justify-center gap-2">
          <SampleJobButton size="md" />
          <ReadyMadeAgentButton size="md" />
        </div>
      )}
    </div>
  );
}
