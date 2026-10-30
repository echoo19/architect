import { DRAFTING_LIMITS } from '@architect/shared';
import {
  Collapse,
  Composer,
  Heading,
  IconButton,
  Stagger,
  StaggerItem,
  Tooltip,
} from '@architect/ui';
import { Cloud, Laptop, Paperclip } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { flowApi } from '../../api/client';
import { useSettings } from '../../api/hooks';
import { ReadyMadeAgentButton } from '../../import/ReadyMadeAgentButton';
import { mentorIsLocal, mentorName } from '../../lib/names';
import { attempt } from '../../lib/notify';
import { AttachedFile } from './AttachedFile';
import { sendToMentor, useDraftStore } from './draft-store';
import { ImportJobButton } from './ImportJobButton';
import { SampleJobButton } from './SampleJobButton';

/**
 * What the paperclip says when asked: what drafting reads and the least it needs, before anything
 * is attached (decision 061).
 */
const FILES_NEEDED = `CSV, text or Markdown files with at least ${DRAFTING_LIMITS.minTasks} rows of records in all (a text file is read whole, up to ${DRAFTING_LIMITS.maxTextChars.toLocaleString('en-US')} characters). Example tasks with their answers go in a .jsonl file.`;

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

  // The box and the files stay as they are when the description is sent: the page leaves with them,
  // and a conversation that is started over puts them back itself.
  const send = (description: string) => sendToMentor(description, files);

  const empty = !text.trim() && files.length === 0;
  return (
    <div className="flex min-h-full flex-col items-center justify-center px-6 pb-[120px] pt-12">
      <Stagger className="flex w-full max-w-[680px] flex-col gap-6">
        <StaggerItem>
          <Heading as="h1" size="display-sm">
            What should your agent do?
          </Heading>
        </StaggerItem>
        <StaggerItem>
          <Composer
            size="hero"
            label="Describe the job"
            placeholder="Describe the job in your own words"
            value={text}
            onValueChange={setText}
            onSubmit={send}
            autoFocus
            leading={
              <Tooltip content={FILES_NEEDED} side="bottom">
                <IconButton label="Attach files" onClick={() => void attach()}>
                  <Paperclip size={18} strokeWidth={1.6} aria-hidden />
                </IconButton>
              </Tooltip>
            }
            trailing={mentor && <TeacherMark name={mentor.name} local={mentor.local} />}
          />
          <Collapse open={files.length > 0}>
            <ul aria-label="Attached files" className="m-0 flex list-none flex-wrap gap-2 p-0 pt-3">
              {files.map((path) => (
                <li key={path} className="min-w-0">
                  <AttachedFile
                    path={path}
                    onRemove={() => setFiles(files.filter((file) => file !== path))}
                  />
                </li>
              ))}
            </ul>
          </Collapse>
        </StaggerItem>
        <StaggerItem>
          <Collapse open={empty}>
            <div className="flex flex-wrap items-center gap-2">
              <SampleJobButton size="sm" />
              <SampleJobButton size="sm" sample="academy" />
              <ReadyMadeAgentButton size="sm" />
              <ImportJobButton size="sm" />
            </div>
          </Collapse>
        </StaggerItem>
      </Stagger>
    </div>
  );
}

/**
 * Who reads what is sent, as a mark by the send button: a cloud for a teacher that works online, a
 * laptop for one on this computer. The name and what it reads are in its tooltip and its label.
 */
function TeacherMark({ name, local }: { name: string; local: boolean }) {
  const says = `Teacher: ${name}. Reads what you send, ${local ? 'on this computer' : 'in the cloud'}.`;
  const Icon = local ? Laptop : Cloud;
  return (
    <Tooltip content={says} side="top">
      <span
        role="img"
        aria-label={says}
        tabIndex={0}
        className="flex size-8 items-center justify-center rounded-mark"
      >
        <Icon size={16} strokeWidth={1.6} aria-hidden />
      </span>
    </Tooltip>
  );
}
