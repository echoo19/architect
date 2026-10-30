import {
  RULE_LIMITS,
  type DraftRecord,
  type RuleDetails,
  type RulePassage,
  type RuleSpec,
} from '@architect/shared';
import { plain } from './rule-reply';
import { ruleSteps } from './rule/steps';
import { wordsOf } from './rule/words';
import { briefly, foldKey } from './values';

/*
 * What a rule rests on, as the person reads it. A passage that is their own answer, such as "No,
 * labor only", can't be read without the question it answered, so each carries it. The draft
 * keeps what the person was asked and what they said (`answers`), and the passage is found there.
 */

/** A question cut to a short line, at a word when there is one. */
function brief(question: string): string {
  return briefly(question, RULE_LIMITS.maxQuestionChars);
}

/**
 * The passages of a rule, each that quotes an answer of the person's naming the question it
 * answered. The answer is the one that holds the passage's words, about a table the rule reads
 * (an answer made before the table was kept is taken for any). Two answers to different questions
 * that hold the same words leave nothing to say which was meant, and the passage is left as it
 * was rather than given a question that may be the wrong one. An answer about a mark such as N/A
 * is never the one a passage quotes without saying so: the passage of a mark carries its own
 * question, and its words, the same as an answer about an empty cell, must not borrow it.
 */
export function withQuestions(
  passages: readonly RulePassage[],
  spec: RuleSpec,
  answers: DraftRecord['answers'],
): RulePassage[] {
  const tables = new Set(
    [spec.table, spec.lookup?.table].flatMap((name) => (name === undefined ? [] : [foldKey(name)])),
  );
  return passages.map((passage) => {
    if (passage.file !== 'answers' || passage.question !== undefined) return passage;
    const wanted = plain(passage.passage);
    const questions = new Set(
      (answers ?? [])
        .filter(
          (item) =>
            item.placeholder === undefined &&
            (item.blank?.table === undefined || tables.has(foldKey(item.blank.table))) &&
            plain(item.answer).includes(wanted),
        )
        .map((item) => item.question),
    );
    const [question] = questions;
    return questions.size === 1 && question !== undefined
      ? { ...passage, question: brief(question) }
      : passage;
  });
}

/** What a rule type's details say, with the question beside each passage that is an answer. */
export function questioned(
  type: DraftRecord['types'][number],
  answers: DraftRecord['answers'],
): RuleDetails | undefined {
  const { details, spec } = type;
  if (details === undefined || spec?.template !== 'rule') return details;
  return { ...details, passages: withQuestions(details.passages, spec, answers) };
}

/**
 * A rule type's details as the person reads them: with the question beside each answer and the
 * rule told as numbered steps. The steps come from the rule's expression when the plan and the
 * report are made, and are never stored, so a draft made before them has them too.
 */
export function readable(
  type: DraftRecord['types'][number],
  answers: DraftRecord['answers'],
): RuleDetails | undefined {
  const details = questioned(type, answers);
  const { spec } = type;
  if (details === undefined || spec?.template !== 'rule') return details;
  return { ...details, steps: ruleSteps(spec.expression, wordsOf(spec)) };
}

/**
 * A text made ready to find passages in, word for word however they are spaced, quoted or
 * emphasised: the test a rule's passages are held to (`checkSources`), for any quotation the
 * teacher makes. The text is made plain once, however many passages are looked for in it.
 */
export function quotesFrom(text: string): (passage: string) => boolean {
  const body = plain(text);
  return (passage) => {
    const wanted = plain(passage);
    return wanted !== '' && body.includes(wanted);
  };
}
