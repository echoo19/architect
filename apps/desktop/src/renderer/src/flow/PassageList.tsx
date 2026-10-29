import { passageSource, type RulePassage } from '@architect/shared';
import { cn } from '@architect/ui';

/**
 * The passages a rule rests on, each quoted beside where it came from: the file, or "your answer"
 * for the person's own words, set apart at the right of the quote so it never runs into it. An
 * answer comes with the question it was to, in the secondary text color, so it reads as one.
 * Define and the report show them the same way.
 */
export function PassageList({
  passages,
  className,
}: {
  passages: readonly RulePassage[];
  className?: string;
}) {
  return (
    <ul className={cn('m-0 flex list-none flex-col gap-2.5 p-0', className)}>
      {passages.map((passage) => (
        <li
          key={`${passage.file}:${passage.question ?? ''}:${passage.passage}`}
          className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-l-2 border-line-control pl-4"
        >
          <span className="min-w-0 max-w-[560px] text-pretty">
            {passage.question !== undefined && (
              <span className="text-fg-secondary">{passage.question} </span>
            )}
            <span>{passage.passage}</span>
          </span>
          <span className="font-mono text-xs text-fg-muted">{passageSource(passage.file)}</span>
        </li>
      ))}
    </ul>
  );
}
