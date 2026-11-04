import { useId, useRef, useState } from 'react';
import { WSP_MIN_EXAMPLES } from '@architect/shared';
import {
  Button,
  Field,
  Heading,
  IconButton,
  InfoTip,
  Input,
  Panel,
  Select,
  Textarea,
  Tooltip,
} from '@architect/ui';
import { FileUp, Plus, X } from 'lucide-react';
import { toError } from '../api/query';
import {
  CHECK_WORDS,
  examplesOf,
  parseExamplesJsonl,
  rowOf,
  splitCounts,
  type CheckKind,
  type ExampleRow,
  type ParsedExamples,
} from './model';
import { StepBody } from './parts';

export interface GoalForm {
  task: string;
  constraints: string;
  rows: ExampleRow[];
}

const CHECK_OPTIONS = (Object.keys(CHECK_WORDS) as CheckKind[]).map((value) => ({
  value,
  label: CHECK_WORDS[value],
}));

/** A fresh row's id: one past the highest, so a removed row's id is never reused. */
const nextId = (rows: readonly ExampleRow[]) =>
  rows.reduce((top, row) => Math.max(top, row.id), 0) + 1;

/** "6 practice, 3 dev, 3 sealed", or how many more it needs. */
function SplitLine({ count }: { count: number }) {
  const split = splitCounts(count);
  if (split === null) {
    return (
      <span className="text-ui tabular-nums">
        <span className="font-medium">{count}</span> of at least {WSP_MIN_EXAMPLES}
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5 text-ui tabular-nums">
      <span>
        <span className="font-medium">{split.practice}</span> practice,{' '}
        <span className="font-medium">{split.dev}</span> dev,{' '}
        <span className="font-medium">{split.qualification}</span> sealed
      </span>
      <InfoTip about="the splits">
        Practice examples are what the mentor and its programs see. Dev examples measure every
        candidate. Sealed examples are kept from both and opened once, to qualify the frozen
        candidate at the end.
      </InfoTip>
    </span>
  );
}

/** What an import couldn't read, by line, up to three of them. */
function ImportProblems({ parsed }: { parsed: ParsedExamples }) {
  if (parsed.problems.length === 0) return null;
  const shown = parsed.problems.slice(0, 3);
  const more = parsed.problems.length - shown.length;
  return (
    <p role="alert" className="m-0 text-small text-danger">
      {parsed.problems.length === 1 ? '1 line was' : `${parsed.problems.length} lines were`} left
      out: {shown.map((problem) => `line ${problem.line} (${problem.reason})`).join(', ')}
      {more > 0 && `, and ${more} more`}
    </p>
  );
}

/** Step two: the behavior to reach, what must not change, and the examples it is measured on. */
export function GoalStep({
  form,
  onChange,
}: {
  form: GoalForm;
  onChange: (form: GoalForm) => void;
}) {
  const ids = useId();
  const file = useRef<HTMLInputElement>(null);
  const [imported, setImported] = useState<ParsedExamples | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const { examples, incomplete } = examplesOf(form.rows);

  const setRow = (id: number, patch: Partial<ExampleRow>) =>
    onChange({
      ...form,
      rows: form.rows.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    });

  const importFile = async (chosen: File) => {
    try {
      const parsed = parseExamplesJsonl(await chosen.text());
      const start = nextId(form.rows);
      // A row left empty makes way for what was imported.
      const kept = form.rows.filter((row) => row.prompt.trim() !== '' || row.value.trim() !== '');
      onChange({
        ...form,
        rows: [...kept, ...parsed.examples.map((example, index) => rowOf(example, start + index))],
      });
      setImported(parsed);
      setImportError(null);
    } catch (error) {
      setImportError(`Couldn't read ${chosen.name}: ${toError(error).message}`);
    }
  };

  return (
    <StepBody title="What should change?">
      <div className="flex flex-col gap-6">
        <Field label="Goal" htmlFor={`${ids}-task`}>
          <Textarea
            id={`${ids}-task`}
            value={form.task}
            placeholder="Stop repeating the same sentence in long answers"
            onChange={(event) => onChange({ ...form, task: event.target.value })}
          />
        </Field>
        <Field label="Constraints" htmlFor={`${ids}-constraints`} optional>
          <Textarea
            id={`${ids}-constraints`}
            value={form.constraints}
            placeholder="What must not change, such as short answers to arithmetic"
            className="min-h-16"
            onChange={(event) => onChange({ ...form, constraints: event.target.value })}
          />
        </Field>
      </div>

      <section aria-label="Examples" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <Heading as="h2" size="title">
              Examples
            </Heading>
            <SplitLine count={examples.length} />
          </div>
          <div className="flex items-center gap-2">
            <input
              ref={file}
              type="file"
              accept=".jsonl,.json,.txt"
              aria-label="JSONL file of examples"
              className="hidden"
              onChange={(event) => {
                const chosen = event.target.files?.[0];
                event.target.value = '';
                if (chosen) void importFile(chosen);
              }}
            />
            <Tooltip content='One {"prompt": …, "check": {"kind": …, "value": …}} per line'>
              <Button size="sm" onClick={() => file.current?.click()}>
                <FileUp size={14} strokeWidth={1.8} aria-hidden />
                Import JSONL
              </Button>
            </Tooltip>
            <Button
              size="sm"
              onClick={() =>
                onChange({
                  ...form,
                  rows: [
                    ...form.rows,
                    { id: nextId(form.rows), prompt: '', kind: 'none', value: '' },
                  ],
                })
              }
            >
              <Plus size={14} strokeWidth={1.8} aria-hidden />
              Add example
            </Button>
          </div>
        </div>
        {imported && <ImportProblems parsed={imported} />}
        {importError && (
          <p role="alert" className="m-0 text-small text-danger">
            {importError}
          </p>
        )}
        {form.rows.length > 0 && (
          <Panel>
            {form.rows.map((row, index) => (
              <div
                key={row.id}
                role="group"
                aria-label={`Example ${index + 1}`}
                className="grid grid-cols-[minmax(0,1fr)_148px_minmax(0,200px)_32px] items-center gap-2 border-t border-line px-4 py-2.5 first:border-t-0"
              >
                <Input
                  aria-label="Prompt"
                  value={row.prompt}
                  placeholder="A prompt the model is given"
                  onChange={(event) => setRow(row.id, { prompt: event.target.value })}
                />
                <Select
                  aria-label="Check"
                  value={row.kind}
                  options={CHECK_OPTIONS}
                  onValueChange={(kind) => setRow(row.id, { kind })}
                  className="min-w-0"
                />
                <Input
                  aria-label="Expected"
                  value={row.value}
                  disabled={row.kind === 'none'}
                  placeholder={row.kind === 'none' ? 'Behavior only' : 'Expected'}
                  onChange={(event) => setRow(row.id, { value: event.target.value })}
                />
                <IconButton
                  label={`Remove example ${index + 1}`}
                  size="sm"
                  onClick={() =>
                    onChange({ ...form, rows: form.rows.filter((item) => item.id !== row.id) })
                  }
                >
                  <X size={14} strokeWidth={1.8} aria-hidden />
                </IconButton>
              </div>
            ))}
          </Panel>
        )}
        {incomplete > 0 && (
          <p className="m-0 text-small">
            {incomplete === 1
              ? '1 row needs a prompt or its check’s value'
              : `${incomplete} rows need a prompt or their check’s value`}
          </p>
        )}
      </section>
    </StepBody>
  );
}
