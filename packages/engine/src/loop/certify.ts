import type {
  Certificate,
  CertificateCheck,
  CertificatePoint,
  CertifySettings,
  StudentTarget,
  Task,
} from '@architect/shared';
import { agreementSeeds, vote } from '../certify/agreement';
import { chooseThreshold, type CurvePoint, type Scored } from '../certify/stats';
import type { GraduateFreeze, StoredAttempt } from '../store/records';
import { configurationKey, type AttemptConfig } from './configuration';
import { evaluate } from './evaluation';
import type { RunState } from './run-state';
import type { OpenedTransfer } from '../vault/vault';

/** What every certificate assumes, in the words the report shows. */
export const CERTIFICATE_ASSUMPTION =
  'Requests like the calibration ones, drawn the same way from the organizations it was taught on, answered with a checked answer or file changes. An organization it never saw tests this assumption rather than inheriting the guarantee. A chat reply in words alone is given only when its attempts say the same thing, and the bound does not cover it.';

/** One task's k attempts as a certificate reads them: the votes for the most common answer. */
export function scoreTask(attempts: readonly StoredAttempt[], seeds: readonly number[]): Scored {
  const ordered = [...attempts]
    .filter((attempt) => seeds.includes(attempt.seed))
    .sort((a, b) => seeds.indexOf(a.seed) - seeds.indexOf(b.seed));
  // An attempt without a key (made before keys were kept) agrees with nothing.
  const best = vote(ordered, (attempt) => attempt.answerKey ?? attempt.id);
  return best === null
    ? { votes: 0, correct: false }
    : { votes: best.votes, correct: best.chosen.check.pass };
}

export function byTask(attempts: readonly StoredAttempt[]): Map<string, StoredAttempt[]> {
  const grouped = new Map<string, StoredAttempt[]>();
  for (const attempt of attempts) {
    grouped.set(attempt.taskId, [...(grouped.get(attempt.taskId) ?? []), attempt]);
  }
  return grouped;
}

function pointOf(point: CurvePoint): CertificatePoint {
  const { votes, answered, errors, coverage, bound } = point;
  return { votes, answered, errors, coverage, bound };
}

/** Where a certified threshold is checked: a place and its tasks' scores. */
export interface CheckGroup {
  /** The organization's id; absent for the taught organizations' locked test together. */
  org?: string;
  orgName?: string;
  seen: boolean;
  synthetic: boolean;
  scored: readonly Scored[];
}

/**
 * The certificate from the calibration tasks' scores, with its threshold run on each group of
 * tasks it wasn't calibrated on: held when the observed selective error there is at most the
 * certified bound.
 */
export function certificateOf(
  settings: Required<Pick<CertifySettings, 'k' | 'epsilon' | 'delta'>>,
  calibration: readonly Scored[],
  groups: readonly CheckGroup[],
): Certificate {
  const { k, epsilon, delta } = settings;
  const choice = chooseThreshold(calibration, { k, epsilon, delta });
  const base = {
    n: calibration.length,
    k,
    delta,
    epsilon,
    curve: choice.curve.map(pointOf),
    assumption: CERTIFICATE_ASSUMPTION,
  };
  if (!choice.certified) {
    return { ...base, issued: false, reason: choice.reason, needed: choice.needed };
  }
  const threshold = pointOf(choice.point);
  const checks: CertificateCheck[] = groups.map(({ scored, ...place }) => {
    const answered = scored.filter((item) => item.votes >= threshold.votes);
    const errors = answered.filter((item) => !item.correct).length;
    return {
      ...place,
      tasks: scored.length,
      answered: answered.length,
      errors,
      held: answered.length === 0 || errors / answered.length <= threshold.bound,
    };
  });
  return { ...base, issued: true, threshold, checks };
}

/**
 * Builds the certificate from the calibration tasks' scores and runs its threshold on the locked
 * test's: on the organizations it was taught on together, and on each it never saw.
 */
export function buildCertificate(input: {
  settings: Required<Pick<CertifySettings, 'k' | 'epsilon' | 'delta'>>;
  calibration: readonly Scored[];
  /** Each locked-test task with its organization and its score. */
  test: readonly { task: Task; scored: Scored }[];
  /** The organizations the test covered that the agent never trained on. */
  unseen: readonly { id: string; name: string; synthetic: boolean }[];
  /** True when every organization it trained on was generated. */
  taughtSynthetic: boolean;
}): Certificate {
  const unseenIds = new Set(input.unseen.map((org) => org.id));
  const taught = input.test.filter(
    ({ task }) => task.org === undefined || !unseenIds.has(task.org),
  );
  return certificateOf(input.settings, input.calibration, [
    ...(taught.length === 0
      ? []
      : [
          {
            seen: true,
            synthetic: input.taughtSynthetic,
            scored: taught.map(({ scored }) => scored),
          },
        ]),
    ...input.unseen.map((org) => ({
      org: org.id,
      orgName: org.name,
      seen: false,
      synthetic: org.synthetic,
      scored: input.test.filter(({ task }) => task.org === org.id).map(({ scored }) => scored),
    })),
  ]);
}

/**
 * Certifies the frozen graduate when its job asks for it (decision 077): opens the sealed
 * calibration split on the mentor's release proof, attempts each of its tasks and each locked-test
 * task k times under the frozen configuration, and builds the certificate. Resolves null for a job
 * that asks for none or has no calibration split sealed, and false when a pause halted it; the
 * next session attempts only what is left.
 */
export async function certify(
  state: RunState,
  frozen: GraduateFreeze,
  test: {
    target: StudentTarget;
    tasks: readonly Task[];
    sealed: OpenedTransfer;
    /** The frozen configuration and the locked test's first seed, whose attempts count. */
    config: AttemptConfig;
    firstSeed: number;
  },
): Promise<Certificate | null | false> {
  const settings = state.job.evaluation.certify;
  if (settings === undefined) return null;
  const proof = await state.resources.releaseMentor();
  const calibration = await state.ctx.deps.vault.openCalibration(state.run.jobId, proof);
  if (calibration.length === 0) {
    state.log(
      'warn',
      "The job asks for a certificate, but no calibration split was sealed when its tasks were split, so the graduate isn't certified.",
    );
    return null;
  }
  const seeds = agreementSeeds(test.firstSeed, settings.k);
  const { config } = test;
  const common = {
    round: null,
    version: frozen.harnessVersion,
    seeds,
    target: test.target,
    purpose: 'locked_test' as const,
    concurrency: 1,
    config,
    ...(frozen.configuration === undefined ? {} : { decoding: frozen.configuration.decoding }),
    sealedData: test.sealed.dataDirs,
  };
  if (!(await evaluate(state, { ...common, tasks: calibration, split: 'certify' }))) return false;
  if (!(await evaluate(state, { ...common, tasks: test.tasks, split: 'test' }))) return false;
  const attemptsOf = (split: 'certify' | 'test') =>
    byTask(
      state.attempts({
        split,
        round: null,
        version: frozen.harnessVersion,
        target: test.target,
        config: configurationKey(config),
      }),
    );
  const calibrated = attemptsOf('certify');
  const tested = attemptsOf('test');
  const taughtOrgs = (state.job.organizations ?? []).filter((org) => org.role === 'train');
  const certificate = buildCertificate({
    settings,
    calibration: calibration.map((task) => scoreTask(calibrated.get(task.id) ?? [], seeds)),
    test: test.tasks.map((task) => ({ task, scored: scoreTask(tested.get(task.id) ?? [], seeds) })),
    unseen: test.sealed.organizations.map(({ id, name, synthetic }) => ({ id, name, synthetic })),
    taughtSynthetic: taughtOrgs.length > 0 && taughtOrgs.every((org) => org.synthetic),
  });
  state.log(
    'info',
    certificate.issued
      ? `Certified: answering when ${certificate.threshold.votes} of ${settings.k} attempts agree, wrong on at most ${(certificate.threshold.bound * 100).toFixed(1)}% with ${Math.round((1 - settings.delta) * 100)}% confidence.`
      : `Not certified (${certificate.reason}).`,
  );
  return certificate;
}
