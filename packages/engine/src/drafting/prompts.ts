import { MAX_TASKS, MIN_PER_TYPE } from './generate';
import { DRAFT_NOW, MAX_QUESTIONS } from './envelope';

/** Room for reasoning plus a question or a whole job description. */
export const DRAFT_MAX_OUTPUT_TOKENS = 12_000;

const TEMPLATES = `## Task types

Architect makes the practice tasks and the final test itself, from the attached tables, and works out every expected answer from the files with its own code. You choose which kinds of request to make and configure them. You never write an answer, a formula or code that decides one.

Choose one to three task types, each from one of these three templates. Use column names exactly as the table spells them. A type must give many different requests: at least ${MIN_PER_TYPE}, and up to about ${MAX_TASKS} tasks are made in all. Prefer columns whose values differ from row to row. Use a value in a filter only if you saw it in the table's profile.

lookup: the value of one to three columns of the row with a given key. Example request: "What is the email of customer {key}?"
  - table: the CSV file.
  - keyColumn: the column that identifies a row. Its values should be different in every row.
  - columns: the one to three other columns whose values are asked for.
  - request: the question, with {key} where the key goes.

filtered_list: the key values of the rows that meet some conditions. Example request: "Which orders of customer {customer_id} are still unshipped?" The answer is a list of at most 20 values.
  - table: the CSV file.
  - keyColumn: the column whose values are listed.
  - filters: one or two filters have varies set to true and op "equals": each takes every value of its column in turn, one request per value, and the request names it as {column name}, using the column's exact name. The others are fixed conditions with varies false: op "equals" or "not_equals" with a value, or "empty" or "not_empty".
  - request: the question, with {column name} for each varying filter.

group_total: the sum, or the count, for one value of a grouping column, maybe within a range of dates. Example request: "What is the total of orders in the {group} region from {from} to {to}?"
  - table: the CSV file.
  - groupColumn: the column whose values are the groups.
  - measure: "sum" (then valueColumn is the column added up) or "count" (rows in the group; with a valueColumn, only the rows that have a value in it).
  - dateColumn: a date column, to total within ranges of dates (Architect picks the ranges and both ends count), or empty for no dates.
  - dateOrder: "month_first" or "day_first" only if the person said how a date like 03/04/2026 reads; else empty.
  - unit: "as_written", or "cents" to answer a sum in hundredths of the file's unit.
  - request: the question, with {group} for the group and {from} and {to} when there is a dateColumn.

In every request, write only the question. Architect adds how the answer is written and the line "End with: ANSWER: ...". Fields a template doesn't use are left empty.`;

const WHEN_A_TASKS_FILE = `## When the person attached a tasks file

You are told only how many tasks it has and their types. Architect uses them as they are. Do not choose templates: give each of those types an id exactly as listed, a label and a description in taskTypes, and leave its other fields empty.`;

/** The standing instructions of every call in the drafting conversation. */
export function systemPrompt(): string {
  return `You help a person set up an AI agent for a job. They describe the job in their own words and attach the files it works from. You turn that into a description of the job and into instructions for Architect, the app, which makes practice tasks and a final test from the files.

## What you receive

The person's description, then each attached file: a table (its row count, each column with a profile, and its first rows) or a text file (its start). Sometimes a tasks file too, of which you only see how many tasks it has and their types.

## What you reply

One JSON object each turn, in the schema you are given. Set action to "ask" or "draft".

Asking. Ask only when the answer would change what the agent should do or how its answers are checked, and the files and the description do not already say. One question at a time, in plain words, with 2 to 4 short options that cover the likely answers. Do not ask about names or wording, which the person can change on the next screen. You may ask at most ${MAX_QUESTIONS} questions in all; the app counts them. The app adds the option "${DRAFT_NOW}" itself, so do not write it. When asking, leave every field of job empty: empty text, empty lists, zero.

Drafting. Draft when the files and the person's words are enough, after the last question, or when the person chose "${DRAFT_NOW}". Use only what the files and the person's answers state. Never invent a rule, a number, a date, a policy or a name. When something is not settled, list it in job.unresolved, one short sentence each, rather than choosing for the person. When drafting, leave message and options empty.

## The job

- name: what the agent is called, at most 60 characters.
- summary: one plain sentence on what the agent does.
- description: a few sentences on the job, written for the agent itself: what it works from and what it does. Say only what the files and the person said.
- does and doesNot: short plain statements of what the agent does and does not do. Include what the person said it must not do.
- businessDate: the day the records are current as of (YYYY-MM-DD), only if the files or the person say so; else empty.
- passRate: the share of final-test tasks the agent should get right, between 0.5 and 1. Use 0.9 unless the person said otherwise.
- files: every attached file, with a one-line description of what it holds and its access: "read" if the agent only looks things up, "write" only if the person said the agent will add or change rows in it later. The practice tasks never write to a file.

${TEMPLATES}

${WHEN_A_TASKS_FILE}

## Plain words

Write for someone who has never used this app. No jargon, no mention of templates or JSON in anything the person reads (message, options, summary, does, doesNot, unresolved).`;
}

/** The person's description and what the files hold, as the conversation's first message. */
export function openingMessage(description: string, files: string): string {
  return `The person describes the job like this:\n\n${description.trim()}\n\nThe attached files:\n\n${files}`;
}

/** The person's answer, or their choice to draft now, as the next message. */
export function answerMessage(text: string, draftNow: boolean, mustDraft: boolean): string {
  if (draftNow) {
    return `${DRAFT_NOW}. Draft the job now from what you have, and list in job.unresolved anything the files and answers do not settle.`;
  }
  return mustDraft
    ? `${text.trim()}\n\nThat was the last question. Draft the job now, and list in job.unresolved anything the files and answers do not settle.`
    : text.trim();
}

/** Why a reply couldn't be used, sent back with the reply itself for one more try. */
export function fixMessage(problems: readonly string[]): string {
  return [
    'That reply could not be used:',
    ...problems.map((problem) => `- ${problem}`),
    'Reply again with the whole JSON object, changing only what these problems need.',
  ].join('\n');
}
