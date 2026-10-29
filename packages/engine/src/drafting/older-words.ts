import type { DraftRecord, RuleDetails } from '@architect/shared';
import {
  NEAREST_CLAUSE,
  answerWords,
  showsRounding,
  tieText,
  unneededRoundingText,
} from './rule/words';

/*
 * Words a rule was written in before they were made plainer: "halves going up" and "half up to
 * the nearest with a tie going up" for what a tie does when it is rounded to the nearest, "A
 * rounding edge" and then "Shows the rounding (labor hours)" for what an example shows, and "The
 * rounding step (...) never changed a value in your records, so no task shows it at work" for a
 * rounding that no record needed. A draft made then keeps what it stored, and nothing stored is
 * rewritten: a rule's version is of the rule itself and the records it was confirmed over, never
 * of the words that tell it, so a confirmation made over the older words holds. It is read in the
 * plainer ones, so every screen and report says the same of a rule whenever it was drafted.
 */

const OLD_TIE = /to the nearest (cent|whole number|multiple of [0-9.]+), halves going up/g;
const OLD_CLAUSE = 'and half up to the nearest with a tie going up';
const OLD_UNNEEDED =
  /^The rounding step \((.+)\) never changed a value in your records, so no task shows it at work\.$/;
const TIE_CLAUSE = /, (?:half a cent|exactly halfway) rounds up$/;
const OLD_SHOWS = /^(?:A rounding edge|Shows the rounding)(?: \((.+)\))?$/;

/** A sentence of a rule, with a tie and a rounding no record needed said the way they are now. */
export function plainerSentence(text: string): string {
  return text
    .replace(OLD_TIE, (_found, unit: string) => `to the nearest ${unit}, ${tieText(unit)}`)
    .replace(OLD_CLAUSE, NEAREST_CLAUSE)
    .replace(OLD_UNNEEDED, (_found, how: string) =>
      unneededRoundingText(how.replace(TIE_CLAUSE, '')),
    );
}

/**
 * What an example shows, said the way it is now. `answer` is what the rule's answer is called in a
 * sentence ("the total"), for the rounding of the answer that the older words called "the result".
 */
export function plainerCover(text: string, answer = 'the result'): string {
  const found = OLD_SHOWS.exec(text);
  if (found === null) return text;
  const [, what] = found;
  if (what === undefined) return showsRounding(null);
  return showsRounding(what === 'the result' ? answer : what);
}

function plainerDetails(details: RuleDetails, answer: string): RuleDetails {
  return {
    ...details,
    statement: plainerSentence(details.statement),
    conventions: details.conventions.map(plainerSentence),
    flags: details.flags.map(plainerSentence),
    examples: details.examples.map((example) => ({
      ...example,
      covers: example.covers.map((cover) => plainerCover(cover, answer)),
      steps: example.steps.map((step) => ({ ...step, text: plainerSentence(step.text) })),
    })),
  };
}

/** The draft as it is read: its rules, their details and its notes in the plainer words. */
export function readInPlainerWords(record: DraftRecord): DraftRecord {
  return {
    ...record,
    notes: record.notes.map(plainerSentence),
    types: record.types.map((type) => {
      const answer = type.spec?.template === 'rule' ? answerWords(type.spec) : 'the result';
      return {
        ...type,
        ...(type.rule === undefined ? {} : { rule: plainerSentence(type.rule) }),
        ...(type.details === undefined ? {} : { details: plainerDetails(type.details, answer) }),
      };
    }),
  };
}
