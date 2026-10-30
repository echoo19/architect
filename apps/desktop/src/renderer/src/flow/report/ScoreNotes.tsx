import { ruleScoreNote, type RuleReport } from '@architect/shared';
import { leftOutNotes } from './left-out';

/**
 * What qualifies the score, read straight under the tiles: that it is how often the agent agreed
 * with the rule the person confirmed, which can't show whether the rule is right for the business,
 * and what that rule left out of the tests. A reader took the 92% for "92% of my bills right", so
 * this is the most important sentence on the page and is set at the size of the page's own text,
 * not in the small print of a tile's note. Both lines qualify the score alike, so they share one
 * block, one size and one color, and neither reads louder than the other. Nothing for a job that
 * has no rule.
 */
export function ScoreNotes({
  rules,
  teacher,
}: {
  rules: readonly RuleReport[] | undefined;
  teacher: string;
}) {
  if (rules === undefined) return null;
  return (
    <div className="flex max-w-[660px] flex-col gap-2.5 text-body text-fg">
      {[ruleScoreNote(teacher), ...leftOutNotes(rules)].map((line) => (
        <p key={line} className="m-0 text-pretty">
          {line}
        </p>
      ))}
    </div>
  );
}
