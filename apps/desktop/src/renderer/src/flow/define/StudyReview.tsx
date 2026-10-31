import { useRef, useState } from 'react';
import type { Job, StudyBrief, StudyClaim, StudyState, TaskPlan } from '@architect/shared';
import { Button, Collapse, Disclosure, Heading, Reveal, Tooltip } from '@architect/ui';
import { BookOpen, Check, CircleAlert, CircleHelp, Sparkles } from 'lucide-react';
import { flowApi } from '../../api/client';
import { queryKeys } from '../../api/hooks';
import { setQueryData } from '../../api/query';
import { attempt } from '../../lib/notify';
import { shortDate } from '../format';
import { modelNames } from '../names';
import { PassageList } from '../PassageList';
import { Recordings } from './Recordings';
import { SheetRow } from './SheetRow';

/**
 * The teacher's study of a field job's organizations, put in front of the person before anything
 * is taught (decision 069): the skills it sees, the rules with their passages, where the
 * organizations differ, and what it found unclear. Training waits until the person confirms it.
 */
export function StudyReview({ job, plan }: { job: Job; plan: TaskPlan }) {
  const { study } = plan;
  const [busy, setBusy] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  if (study === undefined) return null;
  const { mentor } = modelNames(job);
  const keep = (state: StudyState) =>
    setQueryData(queryKeys.taskPlan(job.id), { ...plan, study: state });

  const studyNow = async () => {
    setBusy(true);
    const state = await attempt(`${mentor} couldn't study the material`, () =>
      flowApi.study(job.id),
    );
    setBusy(false);
    if (state) keep(state);
  };

  const confirm = async () => {
    setBusy(true);
    const state = await attempt("Couldn't confirm the brief", () =>
      flowApi.confirmStudy(job.id, study.token),
    );
    setBusy(false);
    if (!state) return;
    keep(state);
    // The brief folds away with its button, so the heading takes the focus and comes into view.
    requestAnimationFrame(() => {
      heading.current?.focus({ preventScroll: true });
      heading.current?.scrollIntoView({ block: 'start' });
    });
  };

  const { state, brief } = study;
  const confirmedOn = study.confirmedAt === undefined ? null : shortDate(study.confirmedAt);
  return (
    <section aria-labelledby="study-brief" className="flex flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3">
        <Heading
          id="study-brief"
          ref={heading}
          tabIndex={-1}
          size="title"
          className="scroll-mt-6 focus-visible:outline-none"
        >
          {`What ${mentor} understood`}
        </Heading>
        {state === 'confirmed' && (
          <Reveal as="span" className="flex items-center gap-1.5 text-small font-medium">
            <Check size={14} strokeWidth={2} aria-hidden />
            {confirmedOn === null ? 'Confirmed' : `Confirmed on ${confirmedOn}`}
          </Reveal>
        )}
      </div>

      <Collapse open={state === 'unstudied'}>
        <div className="flex flex-wrap items-center justify-between gap-4 pb-1 pt-1">
          <p className="m-0 max-w-[560px] text-body text-pretty">
            {`${mentor} reads each academy's files and tells you what it understood before anything is taught.`}
          </p>
          <Button variant="primary" loading={busy} onClick={() => void studyNow()}>
            <BookOpen size={16} strokeWidth={1.8} aria-hidden />
            Study the material
          </Button>
        </div>
      </Collapse>

      <Recordings job={job} plan={plan} mentor={mentor} />

      {state === 'changed' && (
        <div
          role="alert"
          className="mb-4 flex flex-wrap items-center justify-between gap-4 rounded-card bg-danger-soft px-6 py-5"
        >
          <p className="m-0 max-w-[560px] text-pretty">{study.problem}</p>
          <Button loading={busy} onClick={() => void studyNow()}>
            Study again
          </Button>
        </div>
      )}

      <Collapse open={state === 'needed'}>
        {brief !== undefined && (
          <div className="flex flex-col gap-6 pb-1 pt-1">
            <BriefCard brief={brief} mentor={mentor} />
            <div className="flex flex-wrap items-center justify-between gap-4">
              <p className="m-0 font-medium">Is this the job?</p>
              <Button variant="primary" loading={busy} onClick={() => void confirm()}>
                <Check size={16} strokeWidth={2} aria-hidden />
                Confirm and continue
              </Button>
            </div>
          </div>
        )}
      </Collapse>

      {state === 'confirmed' && brief !== undefined && (
        <Disclosure label="Show the brief">
          <BriefCard brief={brief} mentor={mentor} />
        </Disclosure>
      )}
    </section>
  );
}

/** The brief itself: one card, a row for each part. */
function BriefCard({ brief, mentor }: { brief: StudyBrief; mentor: string }) {
  const names = new Map(brief.organizations.map((org) => [org.id, org.name]));
  return (
    <article
      aria-label="The brief"
      className="flex flex-col overflow-hidden rounded-card bg-card px-6 pb-2 pt-1 shadow-edge"
    >
      <SheetRow label="Skills" align="start">
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {brief.skills.map((skill) => (
            <li key={skill.taskType} className="flex flex-col gap-1">
              <span className="flex items-center gap-2 font-medium">
                {skill.label}
                {skill.own && <OwnMark mentor={mentor} />}
              </span>
              <span className="text-pretty">{skill.text}</span>
              {skill.needs.length > 0 && (
                <span className="flex flex-wrap gap-x-3 font-mono text-small">
                  {skill.needs.map((name) => (
                    <span key={name}>{name}</span>
                  ))}
                </span>
              )}
            </li>
          ))}
        </ul>
      </SheetRow>
      {brief.rules.length > 0 && (
        <SheetRow label="Rules" align="start">
          <Claims claims={brief.rules} names={names} mentor={mentor} />
        </SheetRow>
      )}
      {brief.differences.length > 0 && (
        <SheetRow label="Where academies differ" align="start">
          <Claims claims={brief.differences} names={names} mentor={mentor} />
        </SheetRow>
      )}
      {brief.questions.length > 0 && (
        <SheetRow label="Open questions" align="start">
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {brief.questions.map((question) => (
              <li key={question} className="flex items-start gap-2">
                <CircleHelp size={16} strokeWidth={1.8} className="mt-0.5 shrink-0" aria-hidden />
                <span className="text-pretty">{question}</span>
              </li>
            ))}
          </ul>
        </SheetRow>
      )}
      {brief.dropped > 0 && (
        <p className="m-0 flex items-start gap-2 border-t border-line py-4 text-small">
          <CircleAlert size={14} strokeWidth={1.8} className="mt-0.5 shrink-0" aria-hidden />
          {`${brief.dropped} ${brief.dropped === 1 ? 'passage' : 'passages'} ${mentor} quoted ${brief.dropped === 1 ? "wasn't" : "weren't"} in the files, and ${brief.dropped === 1 ? 'was' : 'were'} left out.`}
        </p>
      )}
    </article>
  );
}

/** Claims, each with its passages behind a disclosure, or marked as the teacher's own. */
function Claims({
  claims,
  names,
  mentor,
}: {
  claims: readonly StudyClaim[];
  names: ReadonlyMap<string, string>;
  mentor: string;
}) {
  return (
    <ul className="m-0 flex list-none flex-col gap-3 p-0">
      {claims.map((claim) => (
        <li key={claim.text} className="flex flex-col gap-1">
          <span className="flex items-start gap-2">
            <span className="text-pretty">{claim.text}</span>
            {claim.own && <OwnMark mentor={mentor} />}
          </span>
          {claim.quotes.length > 0 && (
            <Disclosure
              label={`${claim.quotes.length} ${claim.quotes.length === 1 ? 'passage' : 'passages'}`}
            >
              <PassageList
                passages={claim.quotes.map((quote) => ({
                  file: `${names.get(quote.org) ?? quote.org}, ${quote.file}`,
                  passage: quote.passage,
                }))}
              />
            </Disclosure>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Marks a claim no passage backs: the teacher's own reading of the material. */
function OwnMark({ mentor }: { mentor: string }) {
  return (
    <Tooltip content={`${mentor}'s own reading: no passage in the files says it`}>
      <span
        role="img"
        aria-label={`${mentor}'s own reading`}
        className="inline-flex shrink-0 text-mentor"
      >
        <Sparkles size={14} strokeWidth={1.8} aria-hidden />
      </span>
    </Tooltip>
  );
}
