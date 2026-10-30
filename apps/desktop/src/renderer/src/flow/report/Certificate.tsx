import type { Certificate as CertificateRecord } from '@architect/shared';
import { RiskCoveragePlot } from '@architect/ui';
import { CircleCheck, CircleX } from 'lucide-react';
import { Section } from '../ledger';
import {
  certificateBasis,
  certificateSentence,
  checkCounts,
  checkPlace,
  noCertificateSentence,
} from './certificate-words';

/**
 * Certified answers (decision 077): the one sentence a buyer can read, what it rests on and
 * assumes, how error falls as it answers less, and whether the bound held where it wasn't
 * calibrated: the final test and each organization it never saw.
 */
export function Certificate({
  certificate,
  name,
}: {
  certificate: CertificateRecord;
  name: string;
}) {
  const points = certificate.curve.map((point) => ({
    coverage: point.coverage,
    bound: point.bound,
    risk: point.answered === 0 ? null : point.errors / point.answered,
  }));
  const chosen = certificate.issued
    ? certificate.curve.findIndex((point) => point.votes === certificate.threshold.votes)
    : -1;
  return (
    <Section title="Certified answers" id="certificate">
      <div className="flex flex-col gap-6 border-t border-line pt-5">
        <div className="flex max-w-[660px] flex-col gap-2">
          <p className="m-0 text-body text-pretty">
            {certificate.issued
              ? certificateSentence(certificate, name)
              : noCertificateSentence(certificate)}
          </p>
          <p className="m-0 text-small text-pretty">{certificateBasis(certificate)}</p>
          <p className="m-0 text-small text-pretty">{certificate.assumption}</p>
        </div>
        {points.length > 0 && (
          <RiskCoveragePlot
            aria-label="Wrong answers against the share answered, at each agreement threshold"
            points={points}
            target={certificate.epsilon}
            {...(chosen < 0 ? {} : { chosen })}
            className="max-w-[620px]"
          />
        )}
        {certificate.issued && certificate.checks.length > 0 && (
          <ul
            aria-label="Where the bound was checked"
            className="m-0 max-w-[820px] list-none border-b border-line p-0"
          >
            {certificate.checks.map((check) => (
              <li
                key={check.org ?? 'taught'}
                className="grid min-h-12 grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-x-4 border-t border-line py-3 sm:grid-cols-[16px_minmax(0,280px)_minmax(0,1fr)_auto]"
              >
                {check.held ? (
                  <CircleCheck size={16} strokeWidth={1.8} className="text-student" aria-hidden />
                ) : (
                  <CircleX size={16} strokeWidth={1.8} className="text-danger" aria-hidden />
                )}
                <span className="truncate">{checkPlace(check)}</span>
                <span className="hidden text-small tabular-nums sm:block">
                  {checkCounts(check)}
                </span>
                <span className="font-medium">{check.held ? 'Held' : 'Not held'}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Section>
  );
}
