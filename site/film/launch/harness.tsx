import { EyeOff, FileText, GraduationCap, RotateCcw, Wrench, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { ROUNDS } from '../lab/data';
import { Grow } from '../lab/pages-flow';
import { clamp, mix, outQuart, rise, span, ui } from '../lab/time';
import { HARNESS } from './data';
import { T } from './timeline';

/**
 * The round's drawer on the harness itself, rebuilt from the app's round drawer
 * (flow/train/RoundDrawer.tsx, components/FilePatch.tsx): round 1's change across a prompt, a
 * tool and a lesson, then round 2's change to a skill, line by line, with Spark's prediction,
 * which is rolled back when the held-out checks say no. Its moments, in seconds from its start.
 */
export const HARNESS_AT = {
  files: [T.prompts - T.harness, T.tools - T.harness, T.lessons - T.harness],
  second: T.hypothesis - T.harness,
  lines: T.hypothesis - T.harness + 0.5,
  blind: T.blind - T.harness,
  rolledBack: T.rolledBack - T.harness,
} as const;

const KINDS = {
  prompt: { Icon: FileText, label: 'Prompt' },
  tool: { Icon: Wrench, label: 'Tool' },
  lesson: { Icon: GraduationCap, label: 'Lesson' },
} as const;

function Section({
  title,
  children,
  style,
}: {
  title: string;
  children: ReactNode;
  style?: object;
}) {
  return (
    <div className="flex flex-col gap-2.5" style={style}>
      <span className="text-small font-medium">{title}</span>
      {children}
    </div>
  );
}

export function HarnessDrawer({ lt }: { lt: number }) {
  // Round 1 goes up and out before round 2 rises in, so the two are never seen through each other.
  const first = 1 - ui(lt, HARNESS_AT.second, 0.18);
  const second = ui(lt, HARNESS_AT.second + 0.16, 0.32);
  const back = outQuart(span(lt, HARNESS_AT.rolledBack, 0.7));
  const banner = outQuart(span(lt, HARNESS_AT.rolledBack + 0.14, 0.4));
  const [r1, r2] = ROUNDS;
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-line px-6 pb-4 pt-5">
        <span className="grid font-display text-h2 font-semibold">
          <span className="[grid-area:1/1]" style={{ opacity: first }}>
            Round 1: {r1!.title}
          </span>
          <span className="[grid-area:1/1]" style={{ opacity: second }}>
            Round 2: {r2!.title}
          </span>
        </span>
        <X size={18} strokeWidth={1.8} className="shrink-0" aria-hidden />
      </div>
      <div className="relative min-h-0 flex-1">
        {first > 0 && (
          <div
            className="absolute inset-x-0 top-0 flex flex-col gap-5 px-6 pt-5"
            style={{ opacity: first, transform: `translateY(${(first - 1) * 8}px)` }}
          >
            <Section title="What changed in the harness">
              <div className="flex flex-col overflow-hidden rounded-control shadow-edge">
                {HARNESS.first.map((change, index) => {
                  const { Icon, label } = KINDS[change.kind];
                  return (
                    <div
                      key={change.file}
                      className="flex h-14 items-center gap-3 border-t border-line px-4 first:border-t-0"
                      style={rise(lt, HARNESS_AT.files[index]!, 8)}
                    >
                      <Icon size={16} strokeWidth={1.8} className="shrink-0" aria-hidden />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="font-medium">{label}</span>
                        <span className="truncate font-mono text-small">{change.file}</span>
                      </span>
                      <span className="font-mono text-small tabular-nums">
                        <span className="text-student">+{change.added}</span>{' '}
                        <span className="text-danger">−{change.removed}</span>
                      </span>
                    </div>
                  );
                })}
              </div>
            </Section>
          </div>
        )}
        {second > 0 && (
          <div
            className="absolute inset-x-0 top-0 flex flex-col gap-5 px-6 pt-5"
            style={{ opacity: second, transform: `translateY(${(1 - second) * 8}px)` }}
          >
            <div className="grid">
              <div
                className="flex flex-col gap-1 [grid-area:1/1]"
                style={{ opacity: 1 - clamp(back * 3) }}
              >
                <span className="text-small font-medium">Spark expected</span>
                <span className="font-display text-h1 font-semibold tabular-nums">
                  {HARNESS.second.predicted}
                </span>
              </div>
              <div
                className="flex items-center gap-3 rounded-control bg-selected px-4 py-3 [grid-area:1/1]"
                style={{ opacity: banner, transform: `translateY(${(1 - banner) * 6}px)` }}
              >
                <RotateCcw size={18} strokeWidth={1.8} aria-hidden />
                <span className="flex flex-col">
                  <span className="font-display text-h2 font-semibold">Rolled back</span>
                  <span className="text-ui tabular-nums">
                    {HARNESS.second.measured} held-out checks
                  </span>
                </span>
              </div>
            </div>
            <Section title="What changed in the harness">
              <article className="overflow-hidden rounded-control shadow-edge">
                <header className="flex items-baseline gap-3 border-b border-line bg-field px-3.5 py-2.5">
                  <span className="font-mono text-small">{HARNESS.second.file}</span>
                  <span className="text-small">{back > 0.5 ? 'as it was' : 'changed'}</span>
                </header>
                <div className="py-1 font-mono text-small leading-5">
                  {HARNESS.second.lines.map((line, index) => {
                    const shown = outQuart(span(lt, HARNESS_AT.lines + index * 0.14, 0.4));
                    // Rolled back, the added lines go and the removed ones stand again.
                    const height = line.kind === 'added' ? mix(1, 0, back) : 1;
                    const tint = line.kind === 'context' ? 0 : 1 - back;
                    return (
                      <div
                        key={index}
                        className="overflow-hidden"
                        style={{ maxHeight: height * 80 }}
                      >
                        <div
                          className="relative flex gap-2 py-px pr-3"
                          style={{ opacity: shown * clamp(height * 1.4 - 0.2) }}
                        >
                          <span
                            aria-hidden
                            className={`absolute inset-0 ${line.kind === 'added' ? 'bg-student-soft' : 'bg-danger-soft'}`}
                            style={{ opacity: tint }}
                          />
                          <span className="relative w-8 shrink-0 text-right">{line.line}</span>
                          <span
                            className={`relative w-3 shrink-0 text-center ${line.kind === 'added' ? 'text-student' : 'text-danger'}`}
                            style={{ opacity: tint }}
                          >
                            {line.kind === 'added' ? '+' : line.kind === 'removed' ? '−' : ''}
                          </span>
                          <span className="relative min-w-0 whitespace-pre-wrap break-words">
                            {line.text}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </article>
            </Section>
            <Grow p={outQuart(span(lt, HARNESS_AT.blind, 0.5))} height={28}>
              <span className="flex items-center gap-2 text-ui">
                <EyeOff size={15} strokeWidth={1.8} aria-hidden />
                Measured on held-out checks. Spark sees only the score.
              </span>
            </Grow>
          </div>
        )}
      </div>
    </div>
  );
}
