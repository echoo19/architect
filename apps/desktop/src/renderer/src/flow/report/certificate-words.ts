import type { Certificate, CertificateCheck } from '@architect/shared';

/*
 * A certificate in words (decision 077). Each figure is said the way it can be trusted: the
 * bound rounded up, never down, so "at most 8%" is never less than what was certified.
 */

type Issued = Extract<Certificate, { issued: true }>;

/** A bound as a whole percent, rounded up: 0.071 is 8%. */
export function boundPercent(bound: number): number {
  return Math.min(100, Math.ceil(bound * 100 - 1e-9));
}

/** A share as a whole percent, rounded to the nearest. */
function share(value: number): number {
  return Math.round(value * 100);
}

/** "95% confidence" from δ = 0.05. */
function confidence(delta: number): string {
  return `${share(1 - delta)}% confidence`;
}

/**
 * The certificate's one sentence: "When Academy desk answers, it is wrong on at most 8% of requests like
 * these, with 95% confidence. It handed 22% to a person."
 */
export function certificateSentence(certificate: Issued, name: string): string {
  const { bound, coverage } = certificate.threshold;
  const handed = share(1 - coverage);
  const rest = handed === 0 ? 'It answered every one.' : `It handed ${handed}% to a person.`;
  return `When ${name} answers, it is wrong on at most ${boundPercent(bound)}% of requests like these, with ${confidence(certificate.delta)}. ${rest}`;
}

/** How it was measured, in one line: what the sentence rests on. */
export function certificateBasis(certificate: Certificate): string {
  const tasks = `${certificate.n} calibration ${certificate.n === 1 ? 'task' : 'tasks'}`;
  const attempts = `${certificate.k} ${certificate.k === 1 ? 'attempt' : 'attempts'} each`;
  const target = `target ${share(certificate.epsilon)}% at ${confidence(certificate.delta)}`;
  if (!certificate.issued)
    return `Measured on ${tasks} it was never taught on, ${attempts}; ${target}.`;
  const rule =
    certificate.k === 1
      ? 'it answers every request'
      : `it answers when ${certificate.threshold.votes} of ${certificate.k} agree`;
  return `Measured on ${tasks} it was never taught on, ${attempts}: ${rule}; ${target}.`;
}

/** Why no certificate was issued, and what would change that. */
export function noCertificateSentence(
  certificate: Extract<Certificate, { issued: false }>,
): string {
  const target = `${share(certificate.epsilon)}%`;
  switch (certificate.reason) {
    case 'none_answered':
      return `No certificate: its attempts never agreed enough to answer a calibration task.`;
    case 'error_rate':
      return `No certificate: even when every attempt agreed, it was wrong on more than ${target} of calibration tasks.`;
    case 'too_few':
      return certificate.needed === null
        ? `No certificate: ${certificate.n} calibration tasks can't show a bound of ${target}.`
        : `No certificate: ${certificate.n} calibration tasks can't show a bound of ${target}; about ${certificate.needed} would.`;
  }
}

/**
 * Where a check ran: the taught organizations' final test, new tasks at one it was taught on (a
 * certification after the fact, decision 079), or one it never saw, by name, said to be measured
 * before it was taught on once a later version of the field teaches on it (decision 089).
 */
export function checkPlace(check: CertificateCheck): string {
  if (check.seen) {
    return check.orgName === undefined
      ? 'Final test, organizations it was taught on'
      : `New tasks at ${check.orgName}`;
  }
  const place = check.orgName ?? 'An organization it never saw';
  return check.taughtLater === true ? `${place}, measured before it was taught on` : place;
}

/** "Answered 31 of 40, 1 wrong", or that it handed every one to a person. */
export function checkCounts(check: CertificateCheck): string {
  if (check.answered === 0) return `Handed all ${check.tasks} to a person`;
  const wrong = `${check.errors} wrong`;
  return `Answered ${check.answered} of ${check.tasks}, ${wrong}`;
}

/** A certificate in a table cell or a figure: "≤ 8%", or null without one. */
export function certificateFigure(certificate: Certificate | undefined): string | null {
  if (certificate?.issued !== true) return null;
  return `≤ ${boundPercent(certificate.threshold.bound)}%`;
}

/** A certificate's figure explained, for a tooltip or a screen reader. */
export function certificateHint(certificate: Certificate): string {
  if (!certificate.issued) return 'Not certified';
  const { bound, coverage } = certificate.threshold;
  return `Wrong on at most ${boundPercent(bound)}% of the requests it answers, with ${confidence(certificate.delta)}; it answers ${share(coverage)}%`;
}
