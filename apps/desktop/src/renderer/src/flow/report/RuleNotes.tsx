import { passageSource, teachingLine, type RuleReport } from '@architect/shared';
import { DetailList, Disclosure } from '@architect/ui';

/**
 * Everything the final test's expected answers rest on, for a job with a rule: the rule and its
 * version, the passages it came from, when the person confirmed it, how numbers and rounding were
 * read, which rows were left out, what each side of the rule did, and whether teaching ran.
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
          <p className="m-0 max-w-[620px] text-sm text-fg-secondary text-pretty">
            {rule.statement}
          </p>
          <Disclosure label="The rule exactly as Architect evaluates it">
            <pre className="m-0 max-h-72 overflow-auto rounded-xl bg-list p-4 font-mono text-xs leading-5 text-fg-secondary">
              {JSON.stringify(rule.expression, null, 2)}
            </pre>
          </Disclosure>
          <DetailList
            items={[
              { label: 'Version', value: rule.version },
              { label: 'Confirmed', value: rule.confirmedAt.slice(0, 10) },
              {
                label: 'Rows worked out',
                value: `${rule.cases.eligible} of ${rule.cases.total}`,
              },
            ]}
          />
          <Facts title="From your policy">
            {rule.passages.map((passage) => (
              <li key={`${passage.file}:${passage.passage}`}>
                {passage.passage}{' '}
                <span className="font-mono text-xs">{passageSource(passage.file)}</span>
              </li>
            ))}
          </Facts>
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
            <Facts title="What each side of the rule did">
              {rule.branches.map((branch) => (
                <li key={branch.label}>
                  {branch.label}: {branch.cases} {branch.cases === 1 ? 'case' : 'cases'},{' '}
                  {branch.changes} where it changed the answer
                </li>
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
