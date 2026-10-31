import { useRef, useState } from 'react';
import { type Job, type RuleDetails, type RuleExample, type TaskPlan } from '@architect/shared';
import {
  Button,
  cn,
  Collapse,
  DetailList,
  Disclosure,
  Heading,
  Reveal,
  Tooltip,
} from '@architect/ui';
import { Check, CircleAlert, Info, ScrollText } from 'lucide-react';
import { flowApi } from '../../api/client';
import { ProblemState } from '../../components/ProblemState';
import { queryKeys } from '../../api/hooks';
import { setQueryData } from '../../api/query';
import { attempt } from '../../lib/notify';
import { navigate, paths } from '../../lib/router';
import { resetDraft } from '../describe/draft-store';
import { modelNames } from '../names';
import { PassageList } from '../PassageList';
import { RuleSteps } from '../RuleSteps';
import {
  changeHint,
  confirmedOn,
  confirmLine,
  leftOutLine,
  reviewIntro,
  ruleTypesOf,
} from './rule-words';
import { SheetRow } from './SheetRow';

/**
 * The rule of a job, put in front of the person before anything is trained: the passages of their
 * policy it came from, the rule in plain words, and examples with every step of their working. The
 * person confirms it, over these records, or training doesn't start (decision 061).
 */
export function RuleReview({ job, plan }: { job: Job; plan: TaskPlan }) {
  const rules = ruleTypesOf(plan);
  const { confirmation } = plan;
  const [confirming, setConfirming] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  if (rules.length === 0 || confirmation === undefined) return null;
  const { mentor, student } = modelNames(job);
  const needed = confirmation.state === 'needed';
  const confirmed = confirmation.state === 'confirmed';
  const changed = confirmation.state === 'changed';
  const many = rules.length > 1;

  const confirm = async () => {
    setConfirming(true);
    const state = await attempt("Couldn't confirm the rule", () =>
      flowApi.confirmRules(job.id, confirmation.token),
    );
    setConfirming(false);
    if (!state) return;
    setQueryData(queryKeys.taskPlan(job.id), { ...plan, confirmation: state });
    // Confirmed, the rule folds away and takes the button with it, which would leave the person
    // looking at whatever was below. The heading comes into view instead, with the word that says
    // it is confirmed, and takes the focus the button had.
    requestAnimationFrame(() => {
      heading.current?.focus({ preventScroll: true });
      heading.current?.scrollIntoView({ block: 'start' });
    });
  };

  // A rule that isn't right is mended by describing the job again with what was missing, so the
  // same words come back to edit.
  const describeAgain = () => {
    resetDraft({ keepFirstMessage: true });
    navigate(paths.newAgent());
  };

  const cards = (
    <div className="flex flex-col gap-5">
      {rules.map((type) => (
        <RuleCard
          key={type.id}
          label={type.label}
          details={type.details}
          leftOut={leftOutLine(type.details)}
        />
      ))}
    </div>
  );

  return (
    <section aria-labelledby="rule-check" className="flex flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3">
        <Heading
          id="rule-check"
          ref={heading}
          tabIndex={-1}
          size="title"
          className="scroll-mt-6 focus-visible:outline-none"
        >
          {many ? 'Check the rules' : 'Check the rule'}
        </Heading>
        {confirmed && (
          <Reveal as="span" className="flex items-center gap-1.5 text-small font-medium">
            <Check size={14} strokeWidth={2} aria-hidden />
            {`Confirmed${confirmedOn(confirmation) === null ? '' : ` on ${confirmedOn(confirmation)}`}`}
          </Reveal>
        )}
        {changed && (
          <Reveal
            as="span"
            className="flex items-center gap-1.5 text-small font-medium text-danger"
          >
            <CircleAlert size={14} strokeWidth={2} aria-hidden />
            Changed since you confirmed it
          </Reveal>
        )}
      </div>
      <Collapse open={needed}>
        <div className="flex flex-col gap-6 pb-1 pt-1">
          <p className="m-0 max-w-[620px] text-body text-pretty">
            {reviewIntro(mentor, student, rules.length)}
          </p>
          {cards}
          <div className="flex flex-wrap items-center justify-between gap-4">
            <p className="m-0 font-medium">{confirmLine(rules.length)}</p>
            <div className="flex flex-wrap items-center gap-2">
              <Tooltip content={changeHint(mentor)}>
                <Button variant="ghost" onClick={describeAgain}>
                  Change the description
                </Button>
              </Tooltip>
              <Button variant="primary" loading={confirming} onClick={() => void confirm()}>
                <Check size={16} strokeWidth={2} aria-hidden />
                {many ? 'Confirm the rules' : 'Confirm the rule'}
              </Button>
            </div>
          </div>
        </div>
      </Collapse>
      {changed && (
        <ProblemState
          error={
            new Error(confirmation.problem ?? 'The records changed after the rule was confirmed.')
          }
          title="The records changed"
          exit={{ label: 'Describe the job again', onClick: describeAgain }}
          className="mb-4 py-8"
        />
      )}
      {!needed && (
        <Disclosure
          label={
            confirmed
              ? many
                ? 'Show the rules'
                : 'Show the rule'
              : many
                ? 'Show the rules they were confirmed with'
                : 'Show the rule it was confirmed with'
          }
        >
          {cards}
        </Disclosure>
      )}
    </section>
  );
}

function RuleCard({
  label,
  details,
  leftOut,
}: {
  label: string;
  details: RuleDetails;
  leftOut: string | null;
}) {
  const notes = [...details.flags, ...details.uncovered];
  return (
    <article
      aria-label={label}
      className="flex flex-col overflow-hidden rounded-card surface-card px-6 pb-2 pt-5"
    >
      <h3 className="m-0 flex items-center gap-2.5 pb-5 font-display text-h2 font-semibold">
        <ScrollText size={18} strokeWidth={1.7} className="shrink-0" aria-hidden />
        {label}
      </h3>

      <SheetRow label="From your policy" align="start">
        <PassageList passages={details.passages} />
      </SheetRow>

      <SheetRow label="The rule" align="start">
        <RuleSteps steps={details.steps} statement={details.statement} />
      </SheetRow>

      <SheetRow label="Examples" align="start">
        <ul className="m-0 flex list-none flex-col p-0">
          {details.examples.map((example) => (
            <Example key={`${example.taskId ?? 'made'}:${example.request}`} example={example} />
          ))}
        </ul>
      </SheetRow>

      {notes.length > 0 && (
        <SheetRow label="Notes" align="start">
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-small">
            {notes.map((note) => (
              <li key={note} className="flex items-start gap-2">
                <CircleAlert size={14} strokeWidth={1.8} className="mt-0.5 shrink-0" aria-hidden />
                <span className="text-pretty">{note}</span>
              </li>
            ))}
          </ul>
        </SheetRow>
      )}

      <div className="flex flex-col gap-1 border-t border-line py-3">
        {details.excluded.length > 0 && (
          <Disclosure label={leftOut ?? 'Rows left out of the tasks'}>
            <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-small">
              {details.excluded.map((item) => (
                <li key={item.reason} className="text-pretty">
                  {item.count} {item.count === 1 ? 'row' : 'rows'}: {item.reason}
                  {item.example === undefined ? '' : `, such as ${item.example}`}
                </li>
              ))}
            </ul>
          </Disclosure>
        )}
        <Disclosure label="How numbers are read">
          <div className="flex flex-col gap-4">
            <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-small">
              {details.conventions.map((line) => (
                <li key={line} className="text-pretty">
                  {line}
                </li>
              ))}
            </ul>
            <DetailList items={[{ label: 'Rule version', value: details.version }]} />
          </div>
        </Disclosure>
      </div>
    </article>
  );
}

/**
 * One worked example: what is asked and the answer, what it shows, what went in, and every step of
 * the working. One that is not a record reads like one ("Like T-2144, but with parts cost 0.005"
 * was taken for T-2144 with a new price), so its tag comes first, set apart by its weight from the
 * quiet tags beside it, before what the example shows. It is not bad news, so it does not wear the
 * red of a rule that changed since it was confirmed.
 */
function Example({ example }: { example: RuleExample }) {
  return (
    <li className="flex flex-col gap-3 border-t border-line py-5 first:border-t-0 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="min-w-0 text-body text-pretty">{example.request}</span>
        <span className="font-display text-h2 font-semibold tabular-nums">{example.answer}</span>
      </div>
      {(example.covers.length > 0 || example.madeUp === true) && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-small">
          {example.madeUp === true && (
            <span className="inline-flex items-center gap-1.5 font-medium">
              <Info size={14} strokeWidth={2} aria-hidden />
              Not from your records
            </span>
          )}
          {example.covers.map((cover) => (
            <span key={cover}>{cover}</span>
          ))}
        </div>
      )}
      <dl className="m-0 flex flex-wrap gap-x-6 gap-y-1 text-small">
        {example.inputs.map((input) => (
          <div key={input.label} className="flex gap-2">
            <dt>{input.label}</dt>
            <dd className="m-0 font-mono text-small leading-5">{input.value}</dd>
          </div>
        ))}
      </dl>
      <ol className="m-0 flex list-none flex-col gap-1.5 border-t border-line p-0 pt-3 text-small">
        {example.steps.map((step, at) => (
          <li
            key={`${at}:${step.text}`}
            className={cn(
              'grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-4',
              at === example.steps.length - 1 && 'font-medium',
            )}
          >
            <span className="text-pretty">{step.text}</span>
            <span className="font-mono tabular-nums">{step.value}</span>
          </li>
        ))}
      </ol>
    </li>
  );
}
