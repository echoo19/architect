import { branchLine, teachingLine, type RuleReport } from '@architect/shared';
import { DetailList, Disclosure } from '@architect/ui';
import { shortDate } from '../format';
import { PassageList } from '../PassageList';
import { RuleSteps } from '../RuleSteps';

/**
 * Everything the final test's expected answers rest on, for a job with a rule: the rule and its
 * version, the passages it came from, when the person confirmed it, how numbers and rounding were
 * read, which rows were left out, where each side of the rule applied, and whether teaching ran.
 */
export function RuleNotes({ rules, rounds }: { rules: readonly RuleReport[]; rounds: number }) {
  return (
    <div className="mt-4 flex flex-col gap-6">
      {rules.map((rule) => (
        <section
          key={rule.typeId}
          aria-label={`The rule for ${rule.label}`}
          className="flex flex-col gap-3"
        >
          <h4 className="m-0 text-md font-medium">{rule.label}</h4>
          <RuleSteps steps={rule.steps} statement={rule.statement} size="sm" />
          <Disclosure label="The rule exactly as Architect evaluates it">
            {/* All of it, down the page: a rule cut off at a height is not the rule it says it is.
                Only a line wider than the page scrolls, and the keyboard can reach that. */}
            <pre
              tabIndex={0}
              role="region"
              aria-label="Rule expression"
              className="m-0 overflow-x-auto rounded-xl bg-list p-4 font-mono text-xs leading-5 text-fg-secondary"
            >
              {JSON.stringify(rule.expression, null, 2)}
            </pre>
          </Disclosure>
          <DetailList
            items={[
              { label: 'Version', value: rule.version },
              {
                label: 'Confirmed',
                value: shortDate(rule.confirmedAt) ?? rule.confirmedAt.slice(0, 10),
              },
              {
                label: 'Rows worked out',
                value: `${rule.cases.eligible} of ${rule.cases.total}`,
              },
            ]}
          />
          <div className="flex flex-col gap-1.5">
            <h5 className="m-0 text-sm font-normal text-fg-muted">From your policy</h5>
            <PassageList passages={rule.passages} className="text-sm" />
          </div>
          <Facts title="How numbers and rounding were read">
            {rule.conventions.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </Facts>
          {rule.excluded.length > 0 && (
            <Facts title="Rows left out">
              {rule.excluded.map((item) => (
                <li key={item.reason}>
                  {item.count} {item.count === 1 ? 'row' : 'rows'}: {item.reason}
                  {item.example === undefined ? '' : `, such as ${item.example}`}
                </li>
              ))}
            </Facts>
          )}
          {rule.branches.length > 0 && (
            <Facts title="Where each side of the rule applied">
              {rule.branches.map((branch) => (
                <li key={branch.label}>{branchLine(branch)}</li>
              ))}
            </Facts>
          )}
          {rule.flags.length > 0 && (
            <Facts title="Worth knowing">
              {rule.flags.map((flag) => (
                <li key={flag}>{flag}</li>
              ))}
            </Facts>
          )}
        </section>
      ))}
      <p className="m-0 max-w-[620px] text-sm text-fg-secondary text-pretty">
        {teachingLine(rounds)}
      </p>
    </div>
  );
}

function Facts({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <h5 className="m-0 text-sm font-normal text-fg-muted">{title}</h5>
      <ul className="m-0 flex list-none flex-col gap-1 p-0 text-sm text-fg-secondary">
        {children}
      </ul>
    </div>
  );
}
