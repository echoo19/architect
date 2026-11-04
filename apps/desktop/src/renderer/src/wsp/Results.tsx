import type { WspComparison, WspExperiment, WspResult } from '@architect/shared';
import {
  Card,
  CardGrid,
  CardRow,
  DetailList,
  IntervalPlot,
  RowIcon,
  type IntervalGroup,
} from '@architect/ui';
import { CircleMinus, TriangleAlert } from 'lucide-react';
import { formatCost } from '../flow/format';
import { ARM_WORDS, METRIC_WORDS, minutesText, VERDICT_WORDS } from './model';

/** "+8", "−4": a plot's figures, in points. */
const signedPoints = (value: number) => {
  const rounded = Math.round(value);
  return rounded > 0 ? `+${rounded}` : rounded < 0 ? `−${Math.abs(rounded)}` : '0';
};

/** The plot's ends, even about zero, at a round ten past the widest interval. */
export function pointsDomain(comparisons: readonly WspComparison[]): [number, number] {
  const widest = Math.max(
    10,
    ...comparisons.flatMap((item) => [Math.abs(item.low), Math.abs(item.high)]),
  );
  const end = Math.ceil(widest / 10) * 10;
  return [-end, end];
}

const SPLIT_WORDS = { practice: 'Practice', dev: 'Dev', qualification: 'Qualification' } as const;

/**
 * The candidate against each other arm, in points with its 95% interval, a group per split. The
 * sealed qualification's appear only once it has run.
 */
function ComparisonPlot({ result, qualified }: { result: WspResult; qualified: boolean }) {
  const shown = result.comparisons.filter((item) => item.split !== 'qualification' || qualified);
  if (shown.length === 0) return null;
  const splits = (['dev', 'qualification'] as const).filter((split) =>
    shown.some((item) => item.split === split),
  );
  const groups: IntervalGroup[] = splits.map((split) => ({
    label: SPLIT_WORDS[split],
    rows: shown
      .filter((item) => item.split === split)
      .map((item, index) => ({
        id: `${split}-${index}`,
        label: `vs ${ARM_WORDS[item.against]}, ${METRIC_WORDS[item.metric].toLowerCase()}`,
        estimate: item.points,
        low: item.low,
        high: item.high,
        tone: 'student' as const,
      })),
  }));
  const [low, high] = pointsDomain(shown);
  return (
    <Card title="Candidate against each arm">
      <div className="flex flex-col gap-5">
        <p className="m-0 -mt-2 text-small">
          The candidate&rsquo;s rate minus the other arm&rsquo;s, in points, with its 95% interval
        </p>
        <IntervalPlot
          aria-label="Candidate against each arm, in points"
          groups={groups}
          domain={[low, high]}
          ticks={[low, low / 2, 0, high / 2, high]}
          format={signedPoints}
        />
      </div>
    </Card>
  );
}

/** The verdict and what the measurements show, then the candidate against every arm. */
export function ResultSection({
  experiment,
  result,
}: {
  experiment: WspExperiment;
  result: WspResult;
}) {
  return (
    <section aria-label="Result" className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <p className="m-0 font-display text-h1 font-semibold">{VERDICT_WORDS[result.verdict]}</p>
        <p className="m-0 max-w-[760px] text-body text-pretty">{result.summary}</p>
      </div>
      <ComparisonPlot result={result} qualified={experiment.status === 'qualified'} />
    </section>
  );
}

/** What got worse, what wasn't compared and why, and where the candidate may run. */
export function CaveatCards({
  experiment,
  result,
}: {
  experiment: WspExperiment;
  result: WspResult;
}) {
  const { costs } = experiment;
  return (
    <CardGrid className="lg:grid-cols-2 2xl:grid-cols-2">
      <Card title="Regressions" flush>
        {result.regressions.length === 0 ? (
          <p className="m-0 px-6 pb-6 text-ui">None found on the regression checks</p>
        ) : (
          result.regressions.map((regression) => (
            <CardRow
              key={regression}
              icon={
                <RowIcon>
                  <TriangleAlert aria-hidden className="text-danger" />
                </RowIcon>
              }
              title={regression}
            />
          ))
        )}
      </Card>
      <Card title="Not compared" flush>
        {result.notRun.length === 0 ? (
          <p className="m-0 px-6 pb-6 text-ui">Every arm was compared</p>
        ) : (
          result.notRun.map((item) => (
            <CardRow
              key={item.arm}
              icon={
                <RowIcon>
                  <CircleMinus aria-hidden />
                </RowIcon>
              }
              title={item.arm}
              detail={item.reason}
            />
          ))
        )}
      </Card>
      <Card title="Candidate">
        <div className="flex flex-col gap-4">
          <p className="m-0 text-ui">
            <span className="font-medium">
              {result.deployment.status === 'verified'
                ? 'Verified on a local runtime'
                : 'Not verified on a local runtime'}
            </span>
            <span className="block text-pretty">{result.deployment.reason}</span>
          </p>
          <DetailList
            items={[
              ...(experiment.frozen
                ? [
                    { label: 'Frozen candidate', value: experiment.frozen.candidateId },
                    { label: 'Its digest', value: experiment.frozen.digest },
                  ]
                : result.candidateId
                  ? [{ label: 'Candidate', value: result.candidateId }]
                  : []),
              { label: 'Base digest', value: experiment.base.digest },
            ]}
          />
        </div>
      </Card>
      <Card title="Costs">
        <DetailList
          valueFont="text"
          items={[
            {
              label: 'Mentor',
              value: `${formatCost(costs.mentorUsd)} over ${costs.mentorCalls} calls`,
            },
            {
              label: 'Tokens',
              value: `${costs.inputTokens.toLocaleString('en-US')} in, ${costs.outputTokens.toLocaleString('en-US')} out`,
            },
            {
              label: 'Compute',
              value: `${formatCost(costs.computeUsd)}, ${Math.round(costs.computeSeconds)} s`,
            },
            { label: 'Programs', value: costs.programs },
            { label: 'Forward passes', value: costs.forwardPasses },
            { label: 'Wall time', value: minutesText(costs.wallSeconds / 60) },
          ]}
        />
      </Card>
    </CardGrid>
  );
}
