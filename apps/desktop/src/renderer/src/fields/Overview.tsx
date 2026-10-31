import type { StudyState, TaskPlan } from '@architect/shared';
import { Button, Card, CardGrid, CardRow, Skeleton, Stat } from '@architect/ui';
import { BookOpen, ListChecks } from 'lucide-react';
import { useTaskPlan } from '../api/hooks';
import { ProblemState } from '../components/ProblemState';
import { passedOf } from '../flow/format';
import { organizationGrid } from '../flow/report/org-grid';
import { Organizations as OrgGrid } from '../flow/report/Organizations';
import { formatPercent } from '../lib/format';
import { navigate, paths } from '../lib/router';
import { bestCandidate, type FieldSummary } from './model';
import { plural, Quiet } from './parts';
import { Timeline, type FieldTabTarget } from './FieldTimeline';

const STUDY_WORDS: Record<StudyState['state'], string> = {
  unstudied: 'Not studied yet',
  needed: 'Waiting for you',
  confirmed: 'Confirmed',
  changed: 'Material changed',
};

/**
 * The field at a glance: its best candidate skill by organization, its life as one timeline, its
 * skills and the study brief. The grid is the focal point; a field with no candidate yet says so.
 */
export function Overview({
  field,
  openTab,
}: {
  field: FieldSummary;
  openTab: (tab: FieldTabTarget) => void;
}) {
  const best = bestCandidate(field.candidates);
  const grid = best ? organizationGrid(best.report.test.perOrg) : null;
  const openReport = best && (
    <Button variant="ghost" size="sm" onClick={() => navigate(paths.report(best.run.id))}>
      Open report
    </Button>
  );
  return (
    <div className="flex flex-col gap-10">
      {grid ? (
        <OrgGrid grid={grid} actions={openReport} />
      ) : best?.scores.seen ? (
        <Card title="Best candidate" action={openReport}>
          <Stat
            size="lg"
            value={formatPercent(best.scores.seen)}
            label={passedOf(best.scores.seen)}
          />
        </Card>
      ) : (
        <Card title="By organization" flush>
          <Quiet>No candidate has taken its final test yet</Quiet>
        </Card>
      )}
      <StudyAndSkills field={field} openTab={openTab} />
    </div>
  );
}

/** The timeline, then the skills and the study, once the study's state is read. */
function StudyAndSkills({
  field,
  openTab,
}: {
  field: FieldSummary;
  openTab: (tab: FieldTabTarget) => void;
}) {
  const plan = useTaskPlan(field.job.id);
  if (!plan.data) {
    return plan.status === 'error' ? (
      <ProblemState error={plan.error} title="Couldn't read the skills" onRetry={plan.reload} />
    ) : (
      <Skeleton aria-busy="true" className="h-40 rounded-card" />
    );
  }
  return (
    <>
      <Timeline field={field} study={plan.data.study} openTab={openTab} />
      <CardGrid>
        <Skills plan={plan.data} />
        {plan.data.study && <Study jobId={field.job.id} study={plan.data.study} />}
      </CardGrid>
    </>
  );
}

function Skills({ plan }: { plan: TaskPlan }) {
  return (
    <Card title="Skills" icon={<ListChecks strokeWidth={1.8} aria-hidden />} flush>
      {plan.types.map((type) => {
        const { calibration, train, dev, test } = type.counts;
        return (
          <CardRow
            key={type.id}
            title={type.label}
            end={plural(calibration + train + dev + test, 'task')}
          />
        );
      })}
    </Card>
  );
}

/** The study brief in figures, and the way to read it where it is confirmed. */
function Study({ jobId, study }: { jobId: string; study: StudyState }) {
  const brief = study.brief;
  return (
    <Card
      title="Study"
      icon={<BookOpen strokeWidth={1.8} aria-hidden />}
      flush
      action={
        <Button variant="ghost" size="sm" onClick={() => navigate(paths.define(jobId))}>
          Open
        </Button>
      }
    >
      <CardRow title="Brief" end={STUDY_WORDS[study.state]} />
      {brief && (
        <>
          <CardRow title="Skills" end={brief.skills.length} />
          <CardRow title="Rules" end={brief.rules.length} />
          <CardRow title="Where organizations differ" end={brief.differences.length} />
          <CardRow title="Open questions" end={brief.questions.length} />
        </>
      )}
    </Card>
  );
}
