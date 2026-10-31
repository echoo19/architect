import { NUMBER_WORDS, POLICY_SETTINGS } from '../lab/policy';
import type { Policy } from '../lab/policy';

/**
 * A lab's rules read back from its policy.md, however the lab wrote it: from the table at its
 * end when it has one, else from what its sentences or its list of rules say. This is the part
 * of a request the agent does by reading; the numbers then go into the code it runs.
 */
export function readPolicy(text: string): Policy {
  return text.includes(`| ${POLICY_SETTINGS.neg} |`) ? readTable(text) : readText(text);
}

function readTable(text: string): Policy {
  const value = (setting: string): string => {
    const line = text.split('\n').find((row) => row.startsWith(`| ${setting} |`));
    if (line === undefined) throw new Error(`policy.md has no row "${setting}"`);
    return line.split('|')[2]!.trim();
  };
  const hit = value(POLICY_SETTINGS.hit);
  return {
    neg: value(POLICY_SETTINGS.neg),
    pos: value(POLICY_SETTINGS.pos),
    hit: { kind: hit.includes('SD') ? 'sd' : 'percent', value: parseFloat(hit) },
    zMin: Number(value(POLICY_SETTINGS.zMin)),
    band: Number(value(POLICY_SETTINGS.band)),
    agree: Number(value(POLICY_SETTINGS.agree)),
    rule: value(POLICY_SETTINGS.rule).startsWith('mean') ? 'mean' : 'all',
    cap: Number(value(POLICY_SETTINGS.cap)),
    codes: {
      qc: value(POLICY_SETTINGS.qc),
      borderline: value(POLICY_SETTINGS.borderline),
      inconclusive: value(POLICY_SETTINGS.inconclusive),
    },
  };
}

/** The first pattern that matches, and its groups. */
function find(text: string, what: string, patterns: readonly RegExp[]): string[] {
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match) return match.slice(1);
  }
  throw new Error(`policy.md doesn't say ${what}`);
}

function number(word: string): number {
  const spelled = Object.entries(NUMBER_WORDS).find(([, w]) => w === word);
  return spelled ? Number(spelled[0]) : Number(word);
}

function readText(text: string): Policy {
  const [neg] = find(text, 'the negative control', [
    /gives them the compound_id (\S+)\./,
    /Negative control: compound_id (\S+),/,
  ]);
  const [pos] = find(text, 'the positive control', [
    /their compound_id is (\S+)\./,
    /Positive control: compound_id (\S+),/,
  ]);
  const [zMin] = find(text, 'the lowest passing Z′', [
    /Z′ is ([\d.]+) or higher/,
    /passes at Z′ >= ([\d.]+)\./,
  ]);
  const [hitValue, hitUnit] = find(text, 'the hit threshold', [
    /percent inhibition is at least ([\d.]+)(%| standard deviations)/,
    /percent inhibition of ([\d.]+)(% | SD )or more/,
  ]);
  const [agree] = find(text, 'when replicates agree', [/differ by more than ([\w-]+) points/]);
  const [band] = find(text, 'the borderline band', [
    /less than ([\w-]+) points from the hit threshold/,
  ]);
  const [cap] = find(text, 'how many compounds to re-test per plate', [
    /no more than ([\w-]+) compounds per plate/,
    /at most (\d+) per plate/,
  ]);
  const [qc] = find(text, 'the failed-plate code', [
    /whole plate with the reason (\S+), and/,
    /Failed plate: one row for the whole plate, reason (\S+);/,
  ]);
  const [inconclusive] = find(text, 'the inconclusive code', [
    /inconclusive compounds \(reason (\S+)\)/,
  ]);
  const [borderline] = find(text, 'the borderline code', [/borderline ones \(reason (\S+)\)/]);
  return {
    neg: neg!,
    pos: pos!,
    hit: { kind: hitUnit!.startsWith('%') ? 'percent' : 'sd', value: Number(hitValue) },
    zMin: Number(zMin),
    band: number(band!),
    agree: number(agree!),
    rule: /called on the mean of its wells|call a compound on the mean of its wells/.test(text)
      ? 'mean'
      : 'all',
    cap: number(cap!),
    codes: { qc: qc!, borderline: borderline!, inconclusive: inconclusive! },
  };
}
