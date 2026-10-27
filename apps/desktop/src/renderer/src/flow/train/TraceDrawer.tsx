import type { ReactNode } from 'react';
import type { JsonValue, Trace, TraceStep } from '@architect/shared';
import {
  cn,
  DrawerContent,
  ErrorState,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@architect/ui';
import { Ban, BookOpen, Check, CircleX, Wrench } from 'lucide-react';
import { flowApi } from '../../api/client';
import { useQuery } from '../../api/query';
import { clip, formatAnswerTime } from '../format';
import type { RecentAttempt } from './run-state';

const STOP_REASONS: Record<Trace['stopReason'], string | null> = {
  answer: null,
  max_steps: 'Stopped at the step limit before answering.',
  refused: 'Refused the task.',
  error: 'Stopped on an error.',
  aborted: 'Stopped before it finished.',
};

/** One attempt in full: the request, every step and tool call, the answer and the verdict. */
export function TraceDrawerContent({
  attempt,
  type,
  student,
}: {
  attempt: RecentAttempt;
  type: string;
  student: string;
}) {
  const trace = useQuery(`trace:${attempt.id}`, () => flowApi.trace(attempt.id));
  const split = attempt.split === 'dev' ? 'Check task' : 'Practice task';
  return (
    <DrawerContent
      title={clip(attempt.prompt ?? attempt.taskId, 80)}
      subtitle={`${type} · ${split} · harness version ${attempt.harnessVersion}`}
    >
      <div className="flex flex-col gap-7">
        <Verdict attempt={attempt} />
        {attempt.prompt && (
          <Section title="Request">
            <p className="m-0 whitespace-pre-wrap text-md text-fg-soft">{attempt.prompt}</p>
          </Section>
        )}
        {trace.status === 'loading' && (
          <div aria-busy="true" aria-label="Loading the trace" className="flex flex-col gap-3">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        )}
        {trace.status === 'error' && (
          <ErrorState
            layout="inline"
            title="Couldn't load this attempt's steps"
            message={trace.error.message}
            onRetry={trace.reload}
          />
        )}
        {trace.status === 'success' && <TraceSteps trace={trace.data} student={student} />}
      </div>
    </DrawerContent>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="m-0 text-sm font-medium text-fg-secondary">{title}</h3>
      {children}
    </section>
  );
}

function Verdict({ attempt }: { attempt: RecentAttempt }) {
  const { check, answerSummary, expectedSummary } = attempt;
  return (
    <div
      className={cn(
        'flex flex-col gap-3 rounded-xl border px-4 py-3.5',
        check.pass
          ? 'border-student-tile-line bg-student-tile'
          : 'border-danger-line bg-danger-tint',
      )}
    >
      <div className="flex items-start gap-2.5">
        {check.pass ? (
          <Check size={16} strokeWidth={2.2} className="mt-0.5 shrink-0 text-student" aria-hidden />
        ) : (
          <CircleX
            size={16}
            strokeWidth={1.8}
            className="mt-0.5 shrink-0 text-danger"
            aria-hidden
          />
        )}
        <div className="flex flex-col gap-0.5">
          <span className="font-medium">{check.pass ? 'Passed' : 'Failed'}</span>
          <span className="text-fg-secondary text-pretty">{check.reason}</span>
        </div>
      </div>
      {(answerSummary || expectedSummary) && (
        <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 pl-[26px] font-mono text-sm">
          {answerSummary && (
            <>
              <dt className="text-fg-muted">Answered</dt>
              <dd className="m-0 truncate">{answerSummary}</dd>
            </>
          )}
          {expectedSummary && (
            <>
              <dt className="text-fg-muted">Expected</dt>
              <dd className="m-0 truncate">{expectedSummary}</dd>
            </>
          )}
        </dl>
      )}
    </div>
  );
}

/** Model turns with no text only carried tool calls, which their tool steps already show. */
function isShown(step: TraceStep): boolean {
  return step.kind !== 'model' || step.text.trim().length > 0;
}

function TraceSteps({ trace, student }: { trace: Trace; student: string }) {
  const tokens = trace.usage.inputTokens + trace.usage.outputTokens;
  const stopped = STOP_REASONS[trace.stopReason];
  const steps = trace.steps.filter(isShown);
  return (
    <>
      <Section title="Steps">
        {steps.length === 0 ? (
          <p className="m-0 text-fg-secondary">{student} answered without using any tools.</p>
        ) : (
          <ol className="m-0 flex list-none flex-col gap-2.5 p-0">
            {steps.map((step, index) => (
              <li key={index}>
                <StepView step={step} />
              </li>
            ))}
          </ol>
        )}
      </Section>
      <Section title="Final answer">
        {trace.finalText.trim() ? (
          <pre className="m-0 max-h-60 overflow-auto whitespace-pre-wrap rounded-lg border border-line-card bg-well px-3.5 py-3 font-mono text-sm">
            {trace.finalText}
          </pre>
        ) : (
          <p className="m-0 text-fg-secondary">No answer.</p>
        )}
        {(stopped || trace.error) && (
          <p className="m-0 text-sm text-fg-muted">
            {[stopped, trace.error].filter(Boolean).join(' ')}
          </p>
        )}
      </Section>
      <p className="m-0 border-t border-line-card pt-4 font-mono text-xs text-fg-muted">
        {trace.studentModel} · {formatAnswerTime(trace.latencyMs)} ·{' '}
        {tokens.toLocaleString('en-US')} tokens
      </p>
    </>
  );
}

function StepView({ step }: { step: TraceStep }) {
  switch (step.kind) {
    case 'skill':
      return (
        <StepRow icon={<BookOpen size={14} strokeWidth={1.7} aria-hidden />}>
          <span>
            Loaded the <span className="font-mono text-sm">{step.slug}</span> skill
            <span className="text-fg-muted">
              {step.via === 'rule' ? ', by rule' : ', when asked'}
            </span>
          </span>
        </StepRow>
      );
    case 'model':
      return (
        <StepRow meta={formatAnswerTime(step.latencyMs)}>
          <span className="whitespace-pre-wrap text-fg-soft">{step.text}</span>
        </StepRow>
      );
    case 'tool':
      return (
        <StepRow
          icon={<Wrench size={14} strokeWidth={1.7} aria-hidden />}
          meta={formatAnswerTime(step.latencyMs)}
        >
          <div className="flex min-w-0 flex-col gap-2">
            <span className="min-w-0 break-words font-mono text-sm">
              {step.name}
              <span className="text-fg-muted">({JSON.stringify(step.arguments)})</span>
            </span>
            {step.error ? (
              <span className="text-sm text-danger">{step.error}</span>
            ) : (
              <ToolResult result={step.result} />
            )}
          </div>
        </StepRow>
      );
    case 'refusal':
      return (
        <StepRow icon={<Ban size={14} strokeWidth={1.7} aria-hidden />}>
          <span>
            Refused a {step.taskType} task: <span className="text-fg-secondary">{step.reason}</span>
          </span>
        </StepRow>
      );
  }
}

type Cell = string | number | boolean | null;

/** Rows of a table, when a tool returned a list of flat records; otherwise null. */
function asRows(value: JsonValue | null): Record<string, Cell>[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const rows: Record<string, Cell>[] = [];
  for (const item of value) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) return null;
    const cells = Object.values(item);
    if (cells.some((cell) => cell !== null && typeof cell === 'object')) return null;
    rows.push(item as Record<string, Cell>);
  }
  return rows;
}

/** Long results scroll; past this many rows the rest are counted, not drawn. */
const ROW_LIMIT = 50;

function ToolResult({ result }: { result: JsonValue | null }) {
  const rows = asRows(result);
  if (!rows) {
    return (
      <pre className="m-0 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md bg-well px-3 py-2 font-mono text-xs text-fg-secondary">
        {result === null ? 'No result' : JSON.stringify(result, null, 2)}
      </pre>
    );
  }
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  return (
    <div className="max-h-56 overflow-auto rounded-md bg-well px-3 py-1">
      <Table variant="plain" className="text-xs">
        <TableHeader>
          <TableRow>
            {columns.map((column) => (
              <TableHead key={column}>{column}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.slice(0, ROW_LIMIT).map((row, index) => (
            <TableRow key={index}>
              {columns.map((column) => (
                <TableCell key={column}>{String(row[column] ?? '–')}</TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {rows.length > ROW_LIMIT && (
        <p className="m-0 py-2 text-xs text-fg-muted">{rows.length - ROW_LIMIT} more rows</p>
      )}
    </div>
  );
}

function StepRow({
  icon,
  meta,
  children,
}: {
  icon?: ReactNode;
  meta?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="mt-[3px] flex w-3.5 shrink-0 justify-center text-fg-muted">{icon}</span>
      <div className="min-w-0 flex-1">{children}</div>
      {meta && <span className="shrink-0 font-mono text-xs text-fg-muted">{meta}</span>}
    </div>
  );
}
