import { createHash } from 'node:crypto';
import {
  RuleReportSchema,
  type DraftRecord,
  type RuleConfirmation,
  type RuleConfirmationState,
  type RuleReport,
  type RuleSpec,
} from '@architect/shared';
import { ruleVersion } from './templates/rule';

/*
 * The confirmation that binds (decision 061). A rule is confirmed by a person over particular
 * records: the rule as it was worded, by its version, and each file by the hash of its bytes.
 * Change either and the confirmation no longer holds, and since the tasks were made from the
 * old ones, new tasks are needed too.
 */

/** The rule types of a drafted job, with the spec each one was made from. */
export function ruleTypesOf(draft: DraftRecord): { id: string; spec: RuleSpec }[] {
  return draft.types.flatMap((type) =>
    type.spec?.template === 'rule' ? [{ id: type.id, spec: type.spec }] : [],
  );
}

/** What a confirmation would bind to now: the rules' versions and the records' hashes. */
export interface Binding {
  rules: { typeId: string; version: string }[];
  files: { name: string; sha256: string }[];
  /** A short hash of both, which a screen sends back to say what it is confirming. */
  token: string;
}

export function sha256Of(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * The binding as things stand: the rules of the draft, and the hash of each data file as read now
 * (`read` returns null for a file that is gone, which hashes as nothing).
 */
export async function bindingOf(
  draft: DraftRecord,
  names: readonly string[],
  read: (name: string) => Promise<Uint8Array | null>,
): Promise<Binding> {
  const rules = ruleTypesOf(draft).map(({ id, spec }) => ({
    typeId: id,
    version: ruleVersion(spec),
  }));
  const files = await Promise.all(
    names.map(async (name) => {
      const bytes = await read(name);
      return { name, sha256: bytes === null ? 'missing' : sha256Of(bytes) };
    }),
  );
  const token = createHash('sha256')
    .update(JSON.stringify({ rules, files }))
    .digest('hex')
    .slice(0, 16);
  return { rules, files, token };
}

function firstFileChange(
  before: readonly { name: string; sha256: string }[],
  now: readonly { name: string; sha256: string }[],
): string | null {
  const current = new Map(now.map((file) => [file.name, file.sha256]));
  for (const file of before) {
    if (current.get(file.name) !== file.sha256) return file.name;
  }
  return null;
}

/**
 * Where a job's rules stand. The records must still be the ones the tasks were made from, and
 * once confirmed the rules and the records must still be the ones confirmed.
 */
export function stateOf(
  draft: DraftRecord,
  saved: RuleConfirmation | null,
  now: Binding,
): RuleConfirmationState {
  const { token } = now;
  const moved = firstFileChange(draft.files ?? [], now.files);
  if (moved !== null) {
    return {
      state: 'changed',
      token,
      problem: `${moved} is not the file the tasks were made from. Describe the job again, so the tasks and the final test are made from the records as they are now.`,
    };
  }
  if (saved === null) return { state: 'needed', token };
  const versions = new Map(now.rules.map((rule) => [rule.typeId, rule.version]));
  const reworded = saved.rules.some((rule) => versions.get(rule.typeId) !== rule.version);
  if (reworded || saved.rules.length !== now.rules.length) {
    return {
      state: 'changed',
      token,
      problem:
        'The rule is not the one you confirmed. Describe the job again to make tasks for the new rule, and confirm it.',
    };
  }
  const edited = firstFileChange(saved.files, now.files);
  if (edited !== null) {
    return {
      state: 'changed',
      token,
      problem: `${edited} changed after you confirmed the rule. Describe the job again, so the tasks are made from the records as they are now, and confirm the rule again.`,
    };
  }
  return { state: 'confirmed', token, confirmedAt: saved.confirmedAt };
}

/**
 * The rules as the report says them: each rule's details but its examples, with when the person
 * confirmed it. A rule with no confirmation is left out, since no run can have started on it.
 */
export function reportsOf(
  draft: DraftRecord,
  labels: ReadonlyMap<string, string>,
  saved: RuleConfirmation | null,
): RuleReport[] {
  if (saved === null) return [];
  return draft.types.flatMap((type) => {
    if (type.spec?.template !== 'rule' || type.details === undefined) return [];
    const { examples: _examples, uncovered: _uncovered, ...rest } = type.details;
    return [
      RuleReportSchema.parse({
        ...rest,
        typeId: type.id,
        label: labels.get(type.id) ?? type.id,
        confirmedAt: saved.confirmedAt,
        expression: type.spec.expression,
      }),
    ];
  });
}
