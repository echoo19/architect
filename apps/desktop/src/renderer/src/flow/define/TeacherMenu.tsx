import {
  allowedInterventions,
  InterventionTypeSchema,
  type InterventionType,
  type Job,
} from '@architect/shared';
import { Button, ToggleRow } from '@architect/ui';
import { modelNames, kindLabel } from '../names';
import { Issue } from './fields';
import {
  BLOCK_NOTES,
  BLOCK_REASONS,
  isLastChange,
  keyHint,
  weightsBlock,
  type WeightsBlock,
  type WeightsFacts,
} from './teacher-menu';

/** A line under each kind that says what it is, in a few plain words. */
function explanation(type: InterventionType, teacher: string): string {
  switch (type) {
    case 'procedure':
      return 'Rules and step-by-step procedures it follows';
    case 'retrieval':
      return 'Which notes and examples it reads for which request';
    case 'helper':
      return 'Small programs for exact sums and lookups';
    case 'weights':
      return 'Trains the model on checked corrections';
    case 'clarification':
      return `${teacher} may stop and ask you one question`;
  }
}

/**
 * The line a row shows: why its switch can't move, what keeps weights from being trained here
 * while they are on, or else what the kind is.
 */
export function rowNote(
  type: InterventionType,
  state: {
    on: boolean;
    last: boolean;
    block: WeightsBlock | null;
    teacher: string;
    student: string;
  },
): string {
  const { on, last, block, teacher, student } = state;
  const blocked = type === 'weights' && on && block !== null;
  if (last) {
    const stays = `Stays on: ${teacher} needs at least one way to change ${student}.`;
    return blocked
      ? `${stays} Retraining ${student} itself ${BLOCK_REASONS[block]}.${keyHint(block)}`
      : stays;
  }
  return blocked ? BLOCK_NOTES[block] : explanation(type, teacher);
}

/** What each kind of change is made of, at the right of its switch. */
const KIND_TYPES: Record<InterventionType, string> = {
  procedure: 'Text',
  retrieval: 'Notes',
  helper: 'Code',
  weights: 'Weights',
  clarification: 'Question',
};

interface TeacherMenuProps {
  job: Job;
  /** What the app knows of whether weights can be trained here. */
  facts: WeightsFacts;
  /** A problem with the saved choice, from the job's checks. */
  issue?: string | undefined;
  /** Called when a switch moves, with the kind and whether it is now on. */
  onToggle: (type: InterventionType, on: boolean) => void;
  /** Takes the person to where the Hugging Face key is added, offered while it is what is missing. */
  onAddKey?: (() => void) | undefined;
}

/**
 * What the teacher may change on this job, a switch for each kind of change it can make and what
 * the kind is made of at its right. At least one that changes the agent stays on, since a teacher
 * that only asks questions teaches nothing.
 */
export function TeacherMenu({ job, facts, issue, onToggle, onAddKey }: TeacherMenuProps) {
  const { mentor: teacher, student } = modelNames(job);
  const allowed = allowedInterventions(job);
  const block = weightsBlock(job, facts);
  const title = `What ${teacher} may change`;
  return (
    <section aria-label={title} className="flex flex-col">
      <h3 className="m-0 pb-1 text-small font-medium">{title}</h3>
      {InterventionTypeSchema.options.map((type) => {
        const on = allowed.includes(type);
        const last = on && isLastChange(job, type);
        const needsKey = type === 'weights' && on && block === 'no_token' && onAddKey !== undefined;
        return (
          <div
            key={type}
            className="flex flex-col gap-0.5 border-t border-line pb-2.5 first-of-type:border-t-0"
          >
            <ToggleRow
              label={kindLabel(type, student)}
              type={KIND_TYPES[type]}
              checked={on}
              disabled={last}
              onCheckedChange={(next) => onToggle(type, next)}
            />
            <p className="m-0 pl-[52px] text-small text-pretty">
              {rowNote(type, { on, last, block, teacher, student })}
            </p>
            {needsKey && (
              <Button size="xs" className="ml-[52px] mt-1.5 self-start" onClick={onAddKey}>
                Add the key
              </Button>
            )}
          </div>
        );
      })}
      <Issue error={issue} />
    </section>
  );
}
