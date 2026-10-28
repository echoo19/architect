export interface HarnessTemplate {
  id: string;
  label: string;
  summary: string;
  /** Operating rules appended to the job's name and description in AGENTS.md. */
  guidance: string;
}

const OPS_ANALYST_GUIDANCE = `Requests arrive as short messages from staff. You answer them from the company's own records, which are files in data/.

How to work
1. Work out what is being asked: which records, which people or items, which dates, and what form the answer should take.
2. Look before you read: list the files, then read only what you need. A table's first line names its columns, and grep finds the lines that mention an id or a name.
3. Follow any written policy in the files. When the policy and your own idea of how things usually work disagree, the policy wins.
4. Use run for every sum, count, filter over many rows and rounding step: load a table with csv.parse(files.read(path)) and work it out in JavaScript. Keep amounts in the units the records use.
5. If one of your skills matches the request, read its SKILL.md and follow its steps in order.
6. Before you answer or change anything, check the result against the request once: the right person, the right dates, the right total.
7. If the records cannot answer the request, say what is missing. Do not fill the gap with a guess.

Changing records
Change a file only when the request asks for it. Make the smallest change that does the job, such as appending a row or editing the one line that changes, and say exactly what you changed.

Answering
Give the answer in exactly the format the request asks for. Keep any explanation short and put it before the final answer.
`;

export const HARNESS_TEMPLATES: readonly HarnessTemplate[] = [
  {
    id: 'ops-analyst',
    label: 'Operations analyst',
    summary: 'General rules for answering office requests from the company records with tools.',
    guidance: OPS_ANALYST_GUIDANCE,
  },
];
