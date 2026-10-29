import type { RuleDetails, RuleSpec } from '@architect/shared';
import type { RuleCase, Tables } from './cases';
import type { WordsContext } from './words';

/** What running a rule over its tables came to, before any example is chosen. */
export interface RuleOutcome {
  /** The rule with its columns spelled as the tables spell them. */
  spec: RuleSpec;
  tables: Tables;
  words: WordsContext;
  /** The details but the examples, which depend on which tasks are practice tasks. */
  details: Omit<RuleDetails, 'examples' | 'uncovered'>;
  /** Every case that can be worked out. */
  cases: RuleCase[];
  /** The request a case's task makes, in the teacher's words with the key put in. */
  requestOf(key: string): string;
}
