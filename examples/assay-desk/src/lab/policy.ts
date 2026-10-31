/**
 * A lab's rules for reading a screening plate, and its policy.md. Every lab has the same kinds of
 * rule with its own numbers and words, written one of three ways: prose with the numbers in a
 * table at the end (`table`), prose alone with some numbers in words (`prose`), or a short list
 * of rules (`bullets`). The reference reads them back from any of the three (`readPolicy` in
 * src/reference/policy.ts).
 */

export type PolicyStyle = 'table' | 'prose' | 'bullets';
export const POLICY_STYLES: readonly PolicyStyle[] = ['table', 'prose', 'bullets'];

export interface Policy {
  /** The compound_id compounds.csv gives a negative control well (0% inhibition). */
  neg: string;
  /** ...and a positive control well (100% inhibition). */
  pos: string;
  /**
   * `percent`: a hit reaches `value` percent inhibition. `sd`: a hit reaches `value` standard
   * deviations of the negative controls' own percent inhibition.
   */
  hit: { kind: 'percent' | 'sd'; value: number };
  /** The lowest Z′ a plate passes with. */
  zMin: number;
  /** Points either side of the hit threshold that make a compound borderline. */
  band: number;
  /** The most a compound's wells may differ, in points, and still agree. */
  agree: number;
  /** `mean`: the call is on the mean of the wells. `all`: every well must reach the threshold. */
  rule: 'mean' | 'all';
  /** The most compound re-tests requested for one plate. */
  cap: number;
  /** The reason codes retests.csv takes. */
  codes: { qc: string; borderline: string; inconclusive: string };
}

/** The rows of the table at the end of a `table` policy. */
export const POLICY_SETTINGS = {
  neg: 'Negative control (0% inhibition)',
  pos: 'Positive control (100% inhibition)',
  hit: 'Hit threshold',
  zMin: 'Lowest passing Z′',
  band: 'Borderline band, points either side of the threshold',
  agree: 'Replicates agree within, points',
  rule: 'Call on replicates',
  cap: 'Compound re-tests per plate, at most',
  qc: 'Reason code, failed plate',
  borderline: 'Reason code, borderline compound',
  inconclusive: 'Reason code, inconclusive compound',
} as const;

/** Small numbers as a policy written in prose spells them. */
export const NUMBER_WORDS: Readonly<Record<number, string>> = {
  2: 'two',
  3: 'three',
  4: 'four',
  5: 'five',
  6: 'six',
  7: 'seven',
  8: 'eight',
  10: 'ten',
  12: 'twelve',
  15: 'fifteen',
  18: 'eighteen',
  20: 'twenty',
  25: 'twenty-five',
};

function word(n: number): string {
  const spelled = NUMBER_WORDS[n];
  if (spelled === undefined) throw new Error(`No word for ${n}`);
  return spelled;
}

export function policyDocument(name: string, policy: Policy, style: PolicyStyle): string {
  const write = { table: tablePolicy, prose: prosePolicy, bullets: bulletPolicy }[style];
  return `${write(name, policy).join('\n')}\n`;
}

const FILES = [
  '- `plates.csv`: every plate we read: its layout, the instrument, the day it was read and the export file that holds its wells.',
  "- Each instrument's export, the file plates.csv names for a plate: every instrument writes its own columns and its own way of naming a well.",
  '- `compounds.csv`: the well map: which compound, or which control, sits in each well of each plate.',
  '- `retests.csv`: the re-test queue. New requests go at the end.',
];

const READINGS =
  'A well whose export shows no number (left blank, a dash, NaN, or an overflow flag such as OVRFLW) has no reading. Leave it out of every mean, standard deviation and call.';

const INHIBITION =
  "percent inhibition = 100 × (mean of the negative controls − the well's signal) / (mean of the negative controls − mean of the positive controls), with the plate's own control wells that have a reading.";

const Z_PRIME =
  "Z′ = 1 − 3 × (SD of the positive controls + SD of the negative controls) / |mean of the positive controls − mean of the negative controls|, on the plate's raw signals, with the sample standard deviation (divide by n − 1).";

function hitText(policy: Policy, value: string): string {
  return policy.hit.kind === 'percent'
    ? `A compound is a hit when its percent inhibition is at least ${value}%.`
    : `A compound is a hit when its percent inhibition is at least ${value} standard deviations above the negative controls' mean, the standard deviation taken over the negative control wells' own percent inhibition (their mean is 0).`;
}

function ruleText(policy: Policy): string {
  return policy.rule === 'mean'
    ? 'A compound run in more than one well is called on the mean of its wells.'
    : 'A compound run in more than one well is a hit only when every one of its wells reaches the threshold.';
}

function tablePolicy(name: string, policy: Policy): string[] {
  const hit =
    policy.hit.kind === 'percent'
      ? `${policy.hit.value}% inhibition`
      : `${policy.hit.value} SD of the negative controls`;
  const rule = policy.rule === 'mean' ? 'mean of the wells' : 'every well';
  const rows: [string, string][] = [
    [POLICY_SETTINGS.neg, policy.neg],
    [POLICY_SETTINGS.pos, policy.pos],
    [POLICY_SETTINGS.hit, hit],
    [POLICY_SETTINGS.zMin, String(policy.zMin)],
    [POLICY_SETTINGS.band, String(policy.band)],
    [POLICY_SETTINGS.agree, String(policy.agree)],
    [POLICY_SETTINGS.rule, rule],
    [POLICY_SETTINGS.cap, String(policy.cap)],
    [POLICY_SETTINGS.qc, policy.codes.qc],
    [POLICY_SETTINGS.borderline, policy.codes.borderline],
    [POLICY_SETTINGS.inconclusive, policy.codes.inconclusive],
  ];
  return [
    `# ${name}: reading a screening plate`,
    '',
    'How we turn a plate reader export into calls and re-tests. Every plate is normalized to its own controls. The numbers are in the table at the end.',
    '',
    '## Our records',
    '',
    ...FILES,
    '',
    '## Controls and readings',
    '',
    'Each plate carries negative control wells (no inhibitor, 0% inhibition) and positive control wells (the reference inhibitor, 100% inhibition). compounds.csv marks them by compound_id, with the codes in the table.',
    '',
    READINGS,
    '',
    '## Percent inhibition',
    '',
    INHIBITION,
    '',
    '## Plate QC',
    '',
    Z_PRIME,
    '',
    'A plate passes when its Z′ is at least the lowest passing Z′ in the table. A plate that fails gets no hit calls at all: the whole plate is re-tested.',
    '',
    '## Hits and replicates',
    '',
    policy.hit.kind === 'percent'
      ? 'A compound is a hit when its percent inhibition reaches the hit threshold in the table.'
      : "A compound is a hit when its percent inhibition reaches the hit threshold in the table: that many standard deviations above the negative controls' mean, the standard deviation taken over the negative control wells' own percent inhibition (their mean is 0).",
    '',
    `${ruleText(policy)} A compound is inconclusive when any of its wells has no reading, or when its wells' percent inhibition differs by more than the agreement in the table (highest minus lowest). An inconclusive compound is neither a hit nor inactive.`,
    '',
    'A compound that is not inconclusive is borderline when the mean of its wells is less than the borderline band away from the hit threshold, on either side. Borderline hits stay hits; they are re-tested to confirm.',
    '',
    '## Re-tests',
    '',
    'Queue re-tests in retests.csv, one row each: retest_id numbered on from the last row, plate_id, compound_id (empty for a whole plate), reason, and requested_on, the day of the request as YYYY-MM-DD.',
    '',
    'A failed plate gets one row for the whole plate, with the failed-plate code, and none for its compounds. On a plate that passes, re-test the inconclusive compounds and the borderline ones, with their codes, up to the most per plate in the table; when more qualify, any of them will do. Never request what retests.csv already holds for that plate: a plate already queued whole, or a compound already queued on it.',
    '',
    '| Setting | Value |',
    '| --- | --- |',
    ...rows.map(([setting, value]) => `| ${setting} | ${value} |`),
  ];
}

function prosePolicy(name: string, policy: Policy): string[] {
  return [
    `# How ${name} reads a plate`,
    '',
    'This is how we go from a plate reader export to calls and re-tests. Each plate is judged against its own controls, never against another plate.',
    '',
    ...FILES,
    '',
    `Negative control wells hold vehicle only and count as 0% inhibition; compounds.csv gives them the compound_id ${policy.neg}. Positive control wells hold the reference inhibitor and count as 100% inhibition; their compound_id is ${policy.pos}.`,
    '',
    READINGS,
    '',
    INHIBITION,
    '',
    Z_PRIME,
    '',
    `We pass a plate when its Z′ is ${policy.zMin} or higher. A plate below that gets no hit calls; the whole plate goes back for a re-test.`,
    '',
    hitText(policy, String(policy.hit.value)),
    '',
    `${ruleText(policy)} If any well of a compound has no reading, or its wells differ by more than ${word(policy.agree)} points of percent inhibition (highest minus lowest), the compound is inconclusive, neither a hit nor inactive.`,
    '',
    `A compound that isn't inconclusive is borderline when the mean of its wells sits less than ${word(policy.band)} points from the hit threshold, above or below it. A borderline hit is still a hit; it is re-tested to confirm.`,
    '',
    'Re-tests are queued in retests.csv, one row each: retest_id numbered on from the last row, plate_id, compound_id (left empty for a whole plate), reason, and requested_on, the day of the request as YYYY-MM-DD.',
    '',
    `A failed plate gets a single row for the whole plate with the reason ${policy.codes.qc}, and none for its compounds. On a plate that passes, we re-test inconclusive compounds (reason ${policy.codes.inconclusive}) and borderline ones (reason ${policy.codes.borderline}), but no more than ${word(policy.cap)} compounds per plate; when more qualify, any ${word(policy.cap)} of them will do. Never request what retests.csv already holds for that plate: a plate already queued whole, or a compound already queued on it.`,
  ];
}

function bulletPolicy(name: string, policy: Policy): string[] {
  const hit =
    policy.hit.kind === 'percent'
      ? `- Hit: percent inhibition of ${policy.hit.value}% or more.`
      : `- Hit: percent inhibition of ${policy.hit.value} SD or more above the negative controls' mean (0), the SD taken over the negative control wells' own percent inhibition.`;
  const rule =
    policy.rule === 'mean'
      ? '- Replicates: call a compound on the mean of its wells.'
      : '- Replicates: a hit only when every well of the compound reaches the threshold.';
  return [
    `# ${name} plate rules`,
    '',
    ...FILES,
    '',
    `- Negative control: compound_id ${policy.neg}, 0% inhibition.`,
    `- Positive control: compound_id ${policy.pos}, 100% inhibition.`,
    `- ${READINGS}`,
    `- ${INHIBITION}`,
    `- ${Z_PRIME}`,
    `- QC: a plate passes at Z′ >= ${policy.zMin}. A failed plate gets no hit calls and is re-tested whole.`,
    hit,
    rule,
    `- Inconclusive: any well of the compound has no reading, or its wells differ by more than ${policy.agree} points (highest minus lowest). Neither a hit nor inactive.`,
    `- Borderline: not inconclusive, and the mean of its wells is less than ${policy.band} points from the hit threshold, either side. A borderline hit is still a hit.`,
    '- Re-test rows in retests.csv: retest_id numbered on from the last row, plate_id, compound_id (empty for a whole plate), reason, requested_on (the day of the request, YYYY-MM-DD).',
    `- Failed plate: one row for the whole plate, reason ${policy.codes.qc}; none for its compounds.`,
    `- Passing plate: re-test inconclusive compounds (reason ${policy.codes.inconclusive}) and borderline ones (reason ${policy.codes.borderline}), at most ${policy.cap} per plate; when more qualify, any ${policy.cap} will do.`,
    '- Never request what retests.csv already holds for the plate: a plate queued whole, or a compound already queued on it.',
  ];
}
