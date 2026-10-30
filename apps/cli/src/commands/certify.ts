import { setTimeout as sleep } from 'node:timers/promises';
import {
  DEFAULT_CERTIFY_SIZE,
  slugify,
  type Certification,
  type CertifyRequest,
  type CliOutcome,
} from '@architect/shared';
import { pickAgent } from '../agents';
import { countOption, flag, listOption, stringOption, type Parsed, type Values } from '../args';
import type { CliContext } from '../context';
import { asRefusal, CliError } from '../exit';
import { line } from '../render';

/** How often the command looks at a certification's progress. */
const POLL_MS = 1_000;

function share(values: Values, name: string, fallback: number): number {
  const text = stringOption(values, name);
  if (text === undefined) return fallback;
  const value = Number(text);
  if (!Number.isFinite(value) || value <= 0 || value >= 1) {
    throw new CliError(
      'invalid_input',
      'usage',
      `--${name} takes a share between 0 and 1, such as 0.10, not "${text}".`,
    );
  }
  return value;
}

function dollars(values: Values): number {
  const text = stringOption(values, 'max-usd');
  if (text === undefined) return 0;
  const value = Number(text);
  if (!Number.isFinite(value) || value < 0) {
    throw new CliError('invalid_input', 'usage', `--max-usd takes dollars, not "${text}".`);
  }
  return value;
}

function about(seconds: number): string {
  if (seconds < 90 * 60) return `about ${Math.max(1, Math.round(seconds / 60))} minutes`;
  return `about ${(seconds / 3600).toFixed(1)} hours`;
}

function percent(value: number): string {
  return `${Math.min(100, Math.ceil(value * 100 - 1e-9))}%`;
}

/** The same request as one asked for before, so asking again resumes it. */
function sameRequest(a: CertifyRequest, b: CertifyRequest): boolean {
  const sorted = (request: CertifyRequest) =>
    JSON.stringify({ ...request, check: [...new Set(request.check)].sort() });
  return sorted(a) === sorted(b);
}

function describePlan(certification: Certification): string[] {
  const { plan, request } = certification;
  const checks = plan.checks.map((check) => `${check.orgName} (${check.tasks})`).join(', ');
  return [
    `Calibration: ${plan.calibration} tasks of ${plan.jobName} that version ${certification.version}'s run never saw, ${request.k} attempts each, on ${plan.student}.`,
    ...(checks === '' ? [] : [`Checked at: ${checks}.`]),
    `${plan.attempts} attempts, about $${plan.usd.toFixed(2)}, ${about(plan.seconds)}. Caps: $${request.maxUsd.toFixed(2)}, ${request.maxMinutes} minutes.`,
  ];
}

function describeCertificate(certification: Certification, name: string): string[] {
  const certificate = certification.certificate;
  if (certificate === undefined) return [];
  if (!certificate.issued) {
    const needed = certificate.needed === null ? '' : ` About ${certificate.needed} would do.`;
    return [`Not certified (${certificate.reason.replace('_', ' ')}).${needed}`];
  }
  const { bound, coverage, votes } = certificate.threshold;
  const confidence = `${Math.round((1 - certificate.delta) * 100)}% confidence`;
  return [
    `When ${name} answers, it is wrong on at most ${percent(bound)} of requests like these, with ${confidence}. It handed ${Math.round((1 - coverage) * 100)}% to a person.`,
    `It answers when ${votes} of ${certificate.k} attempts agree, measured on ${certificate.n} calibration tasks.`,
    ...certificate.checks.map(
      (check) =>
        `${check.orgName ?? 'Final test'}: answered ${check.answered} of ${check.tasks}, ${check.errors} wrong. ${check.held ? 'Held' : 'Not held'}.`,
    ),
  ];
}

/**
 * `architect certify <agent> --version N --job <job>`: calibrates and certifies a frozen version
 * after the fact, on tasks of the job's taught organizations its run never saw (decision 079).
 * It shows what it will cost before anything spends, stays within --max-usd and --max-minutes,
 * and run again with the same options resumes where it stopped.
 */
export async function certify(
  ctx: CliContext,
  parsed: Parsed,
  signal: AbortSignal,
): Promise<CliOutcome> {
  const { io } = ctx;
  const { values } = parsed;
  const version = countOption(values, 'version');
  const jobNamed = stringOption(values, 'job');
  if (version === undefined || jobNamed === undefined) {
    throw new CliError(
      'invalid_input',
      'usage',
      'Name the version with --version <n> and the job with --job <job>.',
    );
  }
  const engine = await ctx.engine();
  const { api } = engine;
  const agent = pickAgent(await api.graduates.list(), parsed.args[0] ?? '');
  const jobs = await api.jobs.list();
  const job =
    jobs.find((candidate) => candidate.id === jobNamed) ??
    jobs.find((candidate) => slugify(candidate.name) === slugify(jobNamed));
  if (job === undefined) {
    throw new CliError(
      'invalid_input',
      'job_not_found',
      `There is no job called ${jobNamed} here.`,
      'Name a job by its id or its name, or set ARCHITECT_USER_DATA to the folder the app uses.',
    );
  }
  const student = stringOption(values, 'student');
  const request: CertifyRequest = {
    graduateId: agent.id,
    version,
    jobId: job.id,
    k: countOption(values, 'k') ?? 5,
    epsilon: share(values, 'epsilon', 0.1),
    delta: share(values, 'delta', 0.05),
    size: countOption(values, 'calibration-size') ?? DEFAULT_CERTIFY_SIZE,
    check: listOption(values, 'check'),
    ...(student === undefined ? {} : { student }),
    maxUsd: dollars(values),
    maxMinutes: countOption(values, 'max-minutes') ?? 24 * 60,
  };
  if (request.k > 9) {
    throw new CliError('invalid_input', 'usage', '--k takes 1 to 9 attempts per task.');
  }

  const earlier = (await api.graduates.certifications(agent.id, version)).find(
    (item) =>
      (item.status === 'certifying' || item.status === 'paused') &&
      sameRequest(item.request, request),
  );
  let certification: Certification;
  try {
    certification = earlier ?? (await api.graduates.planCertification(request));
  } catch (error) {
    throw asRefusal(error, 'cannot_certify');
  }
  for (const text of describePlan(certification)) line(io.stderr, text);
  if (earlier)
    line(io.stderr, `Resuming: ${earlier.done} of ${earlier.plan.attempts} attempts made.`);
  certification = await api.graduates.startCertification(certification.id);

  let shown = -1;
  while (certification.status === 'certifying') {
    if (signal.aborted) {
      line(io.stderr, 'Stopped. Run the same command again to continue where it stopped.');
      return 'cancelled';
    }
    const tenth = Math.floor((certification.done / certification.plan.attempts) * 10);
    if (tenth !== shown) {
      shown = tenth;
      line(io.stderr, `${certification.done} of ${certification.plan.attempts} attempts`);
    }
    await sleep(POLL_MS, undefined, { signal }).catch(() => undefined);
    const latest = (await api.graduates.certifications(agent.id, version)).find(
      (item) => item.id === certification.id,
    );
    if (latest === undefined) throw new Error('The certification is gone.');
    certification = latest;
  }

  if (certification.status !== 'finished') {
    line(io.stderr, certification.error ?? 'The certification paused.');
    line(io.stderr, 'Run the same command again to continue once that is fixed.');
    return 'runtime_error';
  }
  if (flag(values, 'json')) {
    line(io.stdout, JSON.stringify(certification, null, 2));
  } else {
    for (const text of describeCertificate(certification, agent.name)) line(io.stdout, text);
  }
  return 'succeeded';
}
