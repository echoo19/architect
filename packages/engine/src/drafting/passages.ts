import {
  RULE_LIMITS,
  type DraftRecord,
  type RuleDetails,
  type RulePassage,
  type RuleSpec,
} from '@architect/shared';
import { plain } from './rule-reply';
import { cleanText, foldKey } from './values';

/*
 * What a rule rests on, as the person reads it. A passage that is their own answer, such as "No,
 * labor only", can't be read without the question it answered, so each carries it. The draft
 * keeps what the person was asked and what they said (`answers`), and the passage is found there.
 */

/** A question cut to a short line, at a word when there is one. */
function brief(question: string): string {
  const text = cleanText(question);
  const width = RULE_LIMITS.maxQuestionChars;
  if (text.length <= width) return text;
  const cut = text.slice(0, width - 3);
  const space = cut.lastIndexOf(' ');
  return `${(space > width / 2 ? cut.slice(0, space) : cut).trim()}...`;
}

/**
 * The passages of a rule, each that quotes an answer of the person's naming the question it
 * answered. The answer is the one that holds the passage's words, about a table the rule reads
 * (an answer made before the table was kept is taken for any). Two answers to different questions
 * that hold the same words leave nothing to say which was meant, and the passage is left as it
 * was rather than given a question that may be the wrong one.
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
