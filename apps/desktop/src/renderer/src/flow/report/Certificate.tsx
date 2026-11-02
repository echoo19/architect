import type { Certificate as CertificateRecord } from '@architect/shared';
import { defineTerm, Disclosure, InfoTip, RiskCoveragePlot } from '@architect/ui';
import { CircleCheck, CircleX } from 'lucide-react';
import { Section } from '../ledger';
import {
  certificateBasis,
  certificateSentence,
  checkCounts,
  checkPlace,
  noCertificateSentence,
  riskCertificateFigures,
} from './certificate-words';
import { useEdition } from '../../shell/edition';

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
  const lab = useEdition() === 'lab';
  const points = certificate.curve.map((point) => ({
    coverage: point.coverage,
    bound: point.bound,
    risk: point.answered === 0 ? null : point.errors / point.answered,
  }));
  const chosen = certificate.issued
    ? certificate.curve.findIndex((point) => point.votes === certificate.threshold.votes)
    : -1;
  return (
    <Section
      title={lab ? 'Risk certificate' : 'Certified answers'}
      id="certificate"
      tip={lab && <InfoTip about="risk certificates">{defineTerm('riskCertificate')}</InfoTip>}
    >
      <div className="flex flex-col gap-6 border-t border-line pt-5">
        <div className="flex max-w-[660px] flex-col gap-2">
          <p className="m-0 text-body text-pretty">
            {certificate.issued
              ? certificateSentence(certificate, name)
              : noCertificateSentence(certificate)}
          </p>
          {/* The Lab names the sentence's figures as such, after it. */}
          {lab && certificate.issued && (
            <dl aria-label="Risk certificate figures" className="m-0 flex gap-10 py-2">
              {riskCertificateFigures(certificate).map((figure) => (
                <div key={figure.label} className="flex flex-col-reverse gap-1">
                  <dt className="text-ui">{figure.label}</dt>
                  <dd className="m-0 font-display text-h1 font-semibold tabular-nums">
                    {figure.value}
                  </dd>
                </div>
              ))}
            </dl>
          )}
          {/* What the bound rests on and what it assumes, a click away from the sentence. */}
          <Disclosure label="How this is measured">
            <div className="flex flex-col gap-2 pt-1">
              <p className="m-0 text-ui text-pretty">{certificateBasis(certificate)}</p>
              <p className="m-0 text-ui text-pretty">{certificate.assumption}</p>
            </div>
          </Disclosure>
        </div>
        {points.length > 0 && (
          <RiskCoveragePlot
            aria-label="Wrong answers against the share answered, at each agreement threshold"
            points={points}
            target={certificate.epsilon}
            {...(chosen < 0 ? {} : { chosen })}
          />
        )}
        {certificate.issued && certificate.checks.length > 0 && (
          <ul
            aria-label="Where the bound was checked"
            className="m-0 list-none border-b border-line p-0"
          >
            {certificate.checks.map((check) => (
              <li
                key={check.org ?? 'taught'}
                className="grid min-h-12 grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-x-6 border-t border-line py-3 sm:grid-cols-[16px_minmax(0,1fr)_auto_auto]"
              >
                {check.held ? (
                  <CircleCheck size={16} strokeWidth={1.8} className="text-student" aria-hidden />
                ) : (
                  <CircleX size={16} strokeWidth={1.8} className="text-danger" aria-hidden />
                )}
                <span className="text-pretty">
                  {checkPlace(check, lab ? 'Sealed final test' : 'Final test')}
                </span>
                <span className="hidden whitespace-nowrap text-small tabular-nums sm:block">
                  {checkCounts(check)}
                </span>
                <span className="whitespace-nowrap font-medium">
                  {check.held ? 'Held' : 'Not held'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Section>
  );
}
