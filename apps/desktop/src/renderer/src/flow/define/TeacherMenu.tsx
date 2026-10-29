import {
  allowedInterventions,
  InterventionTypeSchema,
  type InterventionType,
  type Job,
} from '@architect/shared';
import { Button, SettingsRow, SettingsSection, Switch } from '@architect/ui';
import { CircleAlert } from 'lucide-react';
import { kindLabel, modelNames } from '../names';
import { INTERVENTIONS } from '../train/evidence-words';
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
 * What the teacher may change on this job, a switch for each kind of change it can make. At least
 * one that changes the agent stays on, since a teacher that only asks questions teaches nothing.
 */
export function TeacherMenu({ job, facts, issue, onToggle, onAddKey }: TeacherMenuProps) {
  const { mentor: teacher, student } = modelNames(job);
  const allowed = allowedInterventions(job);
  const block = weightsBlock(job, facts);
  return (
    <SettingsSection title={`What ${teacher} may change`}>
      {InterventionTypeSchema.options.map((type) => {
        const on = allowed.includes(type);
        const last = on && isLastChange(job, type);
        const Icon = INTERVENTIONS[type].icon;
        const label = kindLabel(type, student);
        const needsKey = type === 'weights' && on && block === 'no_token' && onAddKey !== undefined;
        const toggle = (
          <Switch
            aria-label={label}
            checked={on}
            disabled={last}
            onCheckedChange={(next) => onToggle(type, next)}
          />
        );
        return (
          <SettingsRow
            key={type}
            icon={<Icon size={16} strokeWidth={1.7} aria-hidden className="text-fg-secondary" />}
            label={label}
            meta={rowNote(type, { on, last, block, teacher, student })}
          >
            {needsKey ? (
              <div className="flex items-center gap-3">
                <Button size="xs" onClick={onAddKey}>
                  Add the key
                </Button>
                {toggle}
              </div>
            ) : (
              toggle
            )}
          </SettingsRow>
        );
      })}
      {issue && (
        <p role="alert" className="m-0 flex items-start gap-1.5 pb-2 text-sm text-fg-muted">
          <CircleAlert size={13} className="mt-[3px] shrink-0 text-danger" aria-hidden />
          {issue}
        </p>
      )}
    </SettingsSection>
  );
}
