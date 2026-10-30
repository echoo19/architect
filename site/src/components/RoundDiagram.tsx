import { cn } from '@architect/ui';
import { Check, Gauge, Lock, Play, Search, Wrench, type LucideIcon } from 'lucide-react';

/**
 * How a round of teaching works, and why the final test is sealed, drawn in the page's own
 * parts: the job's tasks cut into four sets once, then the five steps of a round, then the one
 * opening of the final test. The numbers are the second comparison's plan and report: 15
 * calibration, 60 practice, 45 check and 60 final-test tasks, a change kept only if check-task
 * passes rise by at least 2 a run over two runs, and teaching that stops at the target, after 4
 * rounds in a row with nothing kept, or when its money runs out.
 */

interface Part {
  name: string;
  count: number;
  /** Who sees what of it. */
  rule: string;
  sealed?: boolean;
}

const PARTS: readonly Part[] = [
  { name: 'Calibration', count: 15, rule: 'Prices one attempt before anything runs.' },
  { name: 'Practice', count: 60, rule: "Spark reads Glimmer's attempts at these." },
  { name: 'Check', count: 45, rule: 'Spark sees the score, never the tasks.' },
  {
    name: 'Final test',
    count: 60,
    rule: 'Sealed. Nobody opens it until every setup is frozen.',
    sealed: true,
  },
];

const TOTAL = PARTS.reduce((sum, part) => sum + part.count, 0);

interface Step {
  name: string;
  Icon: LucideIcon;
  text: string;
}

const STEPS: readonly Step[] = [
  { name: 'Practice', Icon: Play, text: 'Glimmer attempts practice tasks.' },
  {
    name: 'Diagnose',
    Icon: Search,
    text: 'Spark reads the failed attempts and finds the step that went wrong.',
  },
  {
    name: 'Change',
    Icon: Wrench,
    text: 'Spark makes one change to the instructions or the small tools.',
  },
  {
    name: 'Check',
    Icon: Gauge,
    text: 'Glimmer attempts the check tasks again, over two runs on new seeds.',
  },
  {
    name: 'Keep or revert',
    Icon: Check,
    text: 'Kept only if passes rise by at least 2 a run and no kind of task loses more than 1. Otherwise it is reverted.',
  },
];

export function RoundDiagram() {
  return (
    <div className="@container flex flex-col gap-12">
      <div
        role="img"
        aria-label="The job's tasks are cut once into 15 calibration, 60 practice, 45 check and 60 final-test tasks."
      >
        <div className="flex gap-1" aria-hidden>
          {PARTS.map((part) => (
            <span
              key={part.name}
              className={cn('h-2 rounded-full', part.sealed ? 'bg-student' : 'bg-fg')}
              style={{ flexBasis: `${(part.count / TOTAL) * 100}%` }}
            />
          ))}
        </div>
        <ul className="m-0 mt-5 grid list-none gap-x-6 gap-y-5 p-0 @md:grid-cols-2 @4xl:grid-cols-4">
          {PARTS.map((part) => (
            <li key={part.name} className="flex flex-col gap-1.5">
              <span className="flex items-center gap-2 font-medium">
                {part.sealed && (
                  <Lock size={15} strokeWidth={1.8} className="text-student" aria-hidden />
                )}
                <span className={part.sealed ? 'text-student' : undefined}>{part.name}</span>
                <span className="font-normal tabular-nums">{part.count}</span>
              </span>
              <span className="max-w-[28ch] text-pretty">{part.rule}</span>
            </li>
          ))}
        </ul>
      </div>

      <ol className="m-0 grid list-none gap-x-6 gap-y-8 p-0 @md:grid-cols-2 @4xl:grid-cols-5">
        {STEPS.map((step, index) => (
          <li key={step.name} className="flex flex-col gap-3 border-t border-line-strong pt-4">
            <span className="flex items-center gap-2.5 font-medium">
              <step.Icon size={18} strokeWidth={1.6} aria-hidden />
              <span className="tabular-nums">{index + 1}</span>
              {step.name}
            </span>
            <span className="max-w-[30ch] text-pretty">{step.text}</span>
          </li>
        ))}
      </ol>

      <div className="flex flex-col gap-2 border-t border-line pt-5 @4xl:flex-row @4xl:justify-between @4xl:gap-12">
        <p className="m-0 max-w-[52ch] text-pretty">
          Rounds repeat until the target is reached, 4 rounds in a row keep nothing, or the money
          runs out.
        </p>
        <p className="m-0 flex max-w-[52ch] items-start gap-2.5 text-pretty">
          <Lock
            size={18}
            strokeWidth={1.6}
            className="mt-[3px] shrink-0 text-student"
            aria-hidden
          />
          <span>
            Then the final test opens once, with Spark disconnected. A program grades it, not a
            model.
          </span>
        </p>
      </div>
    </div>
  );
}
