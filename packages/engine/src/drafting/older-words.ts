import type { DraftRecord, RuleDetails } from '@architect/shared';
import { NEAREST_CLAUSE, tieText } from './rule/words';

/*
 * Words a rule was written in before they were made plainer: "halves going up" and "half up to
 * the nearest with a tie going up" for what a tie does when it is rounded to the nearest, and "A
 * rounding edge" for what an example shows. A draft
 * made then keeps what it stored, and nothing stored is rewritten: a rule's version is of the rule
 * itself and the records it was confirmed over, never of the words that tell it, so a confirmation
 * made over the older words holds. It is read in the plainer ones, so every screen and report says
 * the same of a rule whenever it was drafted.
 */

const OLD_TIE = /to the nearest (cent|whole number|multiple of [0-9.]+), halves going up/g;
const OLD_CLAUSE = 'and half up to the nearest with a tie going up';
const OLD_EDGE = /^A rounding edge/;

/** A sentence of a rule, with a tie said the way it is now. */
export function plainerSentence(text: string): string {
  return text
    .replace(OLD_TIE, (_found, unit: string) => `to the nearest ${unit}, ${tieText(unit)}`)
    .replace(OLD_CLAUSE, NEAREST_CLAUSE);
}

/** What an example shows, said the way it is now. */
export function plainerCover(text: string): string {
  return text.replace(OLD_EDGE, 'Shows the rounding');
}

function plainerDetails(details: RuleDetails): RuleDetails {
  return {
    ...details,
    statement: plainerSentence(details.statement),
    conventions: details.conventions.map(plainerSentence),
    flags: details.flags.map(plainerSentence),
    examples: details.examples.map((example) => ({
      ...example,
      covers: example.covers.map(plainerCover),
      steps: example.steps.map((step) => ({ ...step, text: plainerSentence(step.text) })),
    })),
  };
}

/** The draft as it is read: its rules, their details and its notes in the plainer words. */
export function readInPlainerWords(record: DraftRecord): DraftRecord {
  return {
    ...record,
    notes: record.notes.map(plainerSentence),
    types: record.types.map((type) => ({
      ...type,
      ...(type.rule === undefined ? {} : { rule: plainerSentence(type.rule) }),
      ...(type.details === undefined ? {} : { details: plainerDetails(type.details) }),
    })),
  };
}
