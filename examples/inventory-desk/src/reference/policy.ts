import type { DateForm } from '@architect/example-assay-desk';
import { CHOICES, DATE_FORMS, NUMBER_WORDS, POLICY_SETTINGS } from '../lab/policy';
import type { Policy } from '../lab/policy';
import { UNIT_TEXT } from '../lab/volume';
import type { Unit } from '../lab/volume';

/**
 * A lab's rules read back from its policy.md, however the lab wrote it: from the table at its
 * end when it has one, else from what its sentences or its list of rules say. This is the part
 * of a request the agent does by reading; the numbers then go into the code it runs.
 */
export function readPolicy(text: string): Policy {
  return text.includes(`| ${POLICY_SETTINGS.unit} |`) ? readTable(text) : readText(text);
}

function unitOf(written: string): Unit {
  const unit = (Object.keys(UNIT_TEXT) as Unit[]).find((u) => UNIT_TEXT[u] === written);
  if (unit === undefined) throw new Error(`policy.md names no unit "${written}"`);
  return unit;
}

function dateFormOf(written: string): DateForm {
  const form = (Object.keys(DATE_FORMS) as DateForm[]).find((f) =>
    written.startsWith(DATE_FORMS[f]),
  );
  if (form === undefined) throw new Error(`policy.md names no date form "${written}"`);
  return form;
}

function choiceOf(written: string): Policy['choose'] {
  return written.startsWith(CHOICES.expiry) ? 'expiry' : 'largest';
}

/** Nanolitres in a volume such as `20 µL` or `0.015 mL`. */
function nanolitres(written: string): number {
  const [amount, unit] = written.trim().split(' ') as [string, string];
  return Math.round(Number(amount) * { uL: 1_000, mL: 1_000_000, nL: 1 }[unitOf(unit)]);
}

function readTable(text: string): Policy {
  const value = (setting: string): string => {
    const line = text.split('\n').find((row) => row.startsWith(`| ${setting} |`));
    if (line === undefined) throw new Error(`policy.md has no row "${setting}"`);
    return line.split('|')[2]!.trim();
  };
  return {
    unit: unitOf(value(POLICY_SETTINGS.unit)),
    dateForm: dateFormOf(value(POLICY_SETTINGS.dateForm)),
    minimum: nanolitres(value(POLICY_SETTINGS.minimum)),
    cutoff: Number(value(POLICY_SETTINGS.cutoff)),
    choose: choiceOf(value(POLICY_SETTINGS.choose)),
    combine: value(POLICY_SETTINGS.combine) === 'yes',
    maxHolds: Number(value(POLICY_SETTINGS.maxHolds)),
    codes: {
      expired: value(POLICY_SETTINGS.expired),
      low: value(POLICY_SETTINGS.low),
      limit: value(POLICY_SETTINGS.limit),
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
  const [unit] = find(text, 'its unit', [
    /We write quantities in (\S+)\./,
    /- Quantities: in (\S+)\./,
  ]);
  const [dates] = find(text, 'how it writes dates', [
    /Dates are written ([\w/-]+), as/,
    /- Dates: ([\w/-]+), as/,
  ]);
  const [minimum] = find(text, 'the stock a re-test takes', [
    /Each re-test takes ([\d.]+ (?:µL|mL|nL))/,
  ]);
  const [cutoff] = find(text, 'how long a lot must have left', [
    /expires at least ([\w-]+) days after the day of the request/,
  ]);
  const [choice] = find(text, 'which lot to draw from first', [
    /[Dd]raw from (the lot [^.]+?) first\./,
  ]);
  const [maxHolds] = find(text, 'the most reservations per compound', [
    /already has ([\w-]+) reservations in reservations\.csv/,
    /a compound with (\d+) reservations already/,
  ]);
  const [limit] = find(text, 'the reservation-limit code', [
    /gets no new one, whatever its lots, (?:with )?reason (\S+)\./,
  ]);
  const [expired] = find(text, 'the no-lot-in-date code', [/no lot in date gets reason (\S+);/]);
  const [low] = find(text, 'the too-little code', [/make up a re-test gets reason (\S+)\./]);
  return {
    unit: unitOf(unit!),
    dateForm: dateFormOf(dates!),
    minimum: nanolitres(minimum!),
    cutoff: number(cutoff!),
    choose: choiceOf(choice!),
    combine: text.includes('A re-test may be made up from several lots.'),
    maxHolds: number(maxHolds!),
    codes: { expired: expired!, low: low!, limit: limit! },
  };
}
