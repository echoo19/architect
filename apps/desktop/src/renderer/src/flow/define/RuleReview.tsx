import { useState } from 'react';
import { type Job, type RuleDetails, type RuleExample, type TaskPlan } from '@architect/shared';
import { Badge, Button, cn, DetailList, Disclosure, Heading } from '@architect/ui';
import { Check, CircleAlert, Info, ScrollText } from 'lucide-react';
import { flowApi } from '../../api/client';
import { queryKeys } from '../../api/hooks';
import { setQueryData } from '../../api/query';
import { attempt } from '../../lib/notify';
import { navigate, paths } from '../../lib/router';
import { resetDraft } from '../describe/draft-store';
import { modelNames } from '../names';
import { PassageList } from '../PassageList';
import { RuleSteps } from '../RuleSteps';
import { confirmedOn, confirmLine, leftOutLine, reviewIntro, ruleTypesOf } from './rule-words';

/**
 * The rule of a job, put in front of the person before anything is trained: the passages of their
 * policy it came from, the rule in plain words, and examples with every step of their working. The
 * person confirms it, over these records, or training doesn't start (decision 061).
 */
export function RuleReview({ job, plan }: { job: Job; plan: TaskPlan }) {
  const rules = ruleTypesOf(plan);
  const { confirmation } = plan;
  const [confirming, setConfirming] = useState(false);
  if (rules.length === 0 || confirmation === undefined) return null;
  const { mentor, student } = modelNames(job);
  const confirmed = confirmation.state === 'confirmed';
  const changed = confirmation.state === 'changed';

  const confirm = async () => {
    setConfirming(true);
    const state = await attempt("Couldn't confirm the rule", () =>
      flowApi.confirmRules(job.id, confirmation.token),
    );
    setConfirming(false);
    if (state) setQueryData(queryKeys.taskPlan(job.id), { ...plan, confirmation: state });
  };

  // A rule that isn't right is mended by describing the job again with what was missing, so the
  // same words come back to edit.
  const describeAgain = () => {
    resetDraft({ keepFirstMessage: true });
    navigate(paths.newAgent());
  };

  const cards = rules.map((type) => (
    <RuleCard
      key={type.id}
      label={type.label}
      details={type.details}
      leftOut={leftOutLine(type.details)}
    />
  ));

  return (
    <section aria-labelledby="rule-check" className="flex flex-col gap-[18px]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Heading id="rule-check">
          {rules.length === 1 ? 'Check the rule' : 'Check the rules'}
        </Heading>
        {confirmed && (
          <Badge tone="student" icon={<Check size={14} strokeWidth={2} aria-hidden />}>
            {`Confirmed${confirmedOn(confirmation) === null ? '' : ` on ${confirmedOn(confirmation)}`}`}
          </Badge>
        )}
        {changed && (
          <Badge tone="alert" icon={<CircleAlert size={14} strokeWidth={2} aria-hidden />}>
            Changed since you confirmed it
          </Badge>
        )}
      </div>
      {confirmation.state === 'needed' && (
        <p className="m-0 max-w-[620px] text-fg-secondary text-pretty">
          {reviewIntro(mentor, student, rules.length)}
        </p>
      )}
      {changed && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-danger-line px-6 py-5"
        >
          <p className="m-0 max-w-[560px] text-pretty">{confirmation.problem}</p>
          <Button onClick={describeAgain}>Describe the job again</Button>
        </div>
      )}
      {confirmation.state === 'needed' ? (
        <div className="flex flex-col gap-5">{cards}</div>
      ) : (
        <Disclosure
          label={
            confirmed
              ? rules.length === 1
                ? 'Show the rule'
                : 'Show the rules'
              : rules.length === 1
                ? 'Show the rule it was confirmed with'
                : 'Show the rules they were confirmed with'
          }
        >
          <div className="flex flex-col gap-5">{cards}</div>
        </Disclosure>
      )}
      {confirmation.state === 'needed' && (
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-list px-6 py-5">
          <p className="m-0 max-w-[520px] text-fg-secondary text-pretty">
            {confirmLine(mentor, rules.length)}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" onClick={describeAgain}>
              Change the description
            </Button>
            <Button variant="primary" loading={confirming} onClick={() => void confirm()}>
              <Check size={16} strokeWidth={2} aria-hidden />
              {rules.length === 1 ? 'Confirm the rule' : 'Confirm the rules'}
            </Button>
          </div>
        </div>
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
      className="flex flex-col gap-6 rounded-3xl border border-line-card bg-card px-7 py-[26px]"
    >
      <header>
        <h3 className="m-0 flex items-center gap-2.5 text-lg font-medium">
          <ScrollText size={18} strokeWidth={1.7} className="shrink-0 text-fg-muted" aria-hidden />
          {label}
        </h3>
      </header>

      <div className="flex flex-col gap-3">
        <h4 className="m-0 text-sm font-normal text-fg-muted">From your policy</h4>
        <PassageList passages={details.passages} />
      </div>

      <div className="flex flex-col gap-3">
        <h4 className="m-0 text-sm font-normal text-fg-muted">The rule, in words</h4>
        <RuleSteps steps={details.steps} statement={details.statement} />
      </div>

      <div className="flex flex-col gap-3.5">
        <h4 className="m-0 text-sm font-normal text-fg-muted">Examples</h4>
        <ul className="m-0 flex list-none flex-col gap-3.5 p-0">
          {details.examples.map((example) => (
            <Example key={`${example.taskId ?? 'made'}:${example.request}`} example={example} />
          ))}
        </ul>
      </div>

      {notes.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-sm text-fg-muted">
          {notes.map((note) => (
            <li key={note} className="flex items-start gap-2">
              <CircleAlert size={14} strokeWidth={1.8} className="mt-0.5 shrink-0" aria-hidden />
              <span className="text-pretty">{note}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-1">
        {details.excluded.length > 0 && (
          <Disclosure label={leftOut ?? 'Rows left out of the tasks'}>
            <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-sm text-fg-secondary">
              {details.excluded.map((item) => (
                <li key={item.reason} className="text-pretty">
                  {item.count} {item.count === 1 ? 'row' : 'rows'}: {item.reason}
                  {item.example === undefined ? '' : `, such as ${item.example}`}
                </li>
              ))}
            </ul>
          </Disclosure>
        )}
        <Disclosure label="Details">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <h5 className="m-0 text-sm font-normal text-fg-muted">
                How numbers and rounding are read
              </h5>
              <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-sm text-fg-secondary">
                {details.conventions.map((line) => (
                  <li key={line} className="text-pretty">
                    {line}
                  </li>
                ))}
              </ul>
            </div>
            <DetailList items={[{ label: 'Rule version', value: details.version }]} />
          </div>
        </Disclosure>
      </div>
    </article>
  );
}

/**
 * One worked example. One that is not a record reads like one ("Like T-2144, but with parts cost
 * 0.005" was taken for T-2144 with a new price), so its tag comes first, set apart from the quiet
 * tags beside it, before what the example shows. It is not bad news, so it does not wear the red
 * of a rule that changed since it was confirmed.
 */
function Example({ example }: { example: RuleExample }) {
  return (
    <li className="flex flex-col gap-3.5 rounded-2xl border border-line-card bg-panel px-5 py-[18px]">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="min-w-0 text-md text-pretty">{example.request}</span>
        <span className="text-xl font-medium tabular-nums">{example.answer}</span>
      </div>
      {(example.covers.length > 0 || example.madeUp === true) && (
        <div className="flex flex-wrap gap-2">
          {example.madeUp === true && (
            <Badge tone="emphasis" icon={<Info size={14} strokeWidth={2} aria-hidden />}>
              Not from your records
            </Badge>
          )}
          {example.covers.map((cover) => (
            <Badge key={cover} tone="neutral">
              {cover}
            </Badge>
          ))}
        </div>
      )}
      <dl className="m-0 flex flex-wrap gap-x-6 gap-y-1 text-sm">
        {example.inputs.map((input) => (
          <div key={input.label} className="flex gap-2">
            <dt className="text-fg-muted">{input.label}</dt>
            <dd className="m-0 font-mono text-xs leading-5 text-fg-secondary">{input.value}</dd>
          </div>
        ))}
      </dl>
      <ol className="m-0 flex list-none flex-col gap-1.5 border-t border-line-row p-0 pt-3 text-sm">
        {example.steps.map((step, at) => (
          <li
            key={`${at}:${step.text}`}
            className={cn(
              'grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-4',
              at === example.steps.length - 1 && 'font-medium',
            )}
          >
            <span className="text-pretty text-fg-secondary">{step.text}</span>
            <span className="font-mono tabular-nums">{step.value}</span>
          </li>
        ))}
      </ol>
    </li>
  );
}
