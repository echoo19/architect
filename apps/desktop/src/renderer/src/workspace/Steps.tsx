import { useId, useState, type ReactNode } from 'react';
import type { AgentStep, Consultation, StepView, WorkspaceMessage } from '@architect/shared';
import {
  AgentAvatar,
  cn,
  Collapse,
  InfoTip,
  Reveal,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  VersionTag,
} from '@architect/ui';
import { ChevronRight, CircleAlert, Layers } from 'lucide-react';
import { CodeView } from '../components/CodeView';
import {
  answerText,
  cellText,
  consultMeta,
  currentStep,
  isFigureColumn,
  stepCount,
  stepWords,
  workedLabel,
} from './labels';
import type { PanelContent } from './SidePanel';
import { FlagButton } from './teach/FlagButton';

/** A step reads in the ink of the text around it, unless it failed. */
const NAME_TONE: Partial<Record<AgentStep['status'], string>> = { error: 'text-danger' };

/** Rows a table read shows under its step before "Show all". */
const STEP_TABLE_ROWS = 4;

/** A list of steps, indented under a hairline, so whose work it is reads from its edge. */
const STEP_LIST =
  'm-0 ml-1.5 flex min-w-0 list-none flex-col border-l border-line-strong py-0 pl-4 pr-0 text-small leading-normal';

export interface StepsProps {
  message: WorkspaceMessage;
  /** Whether the list starts open, from the "Tool steps" setting. */
  startOpen: boolean;
  /** The reply is held until the user answers a write it wants to make. */
  waiting: boolean;
  onOpenPanel: (content: PanelContent) => void;
  /** In a team reply, opens Teach this for the teammate's answer that a consult step shows. */
  onFlagConsultation?: (consultation: Consultation) => void;
}

/** "Read data/jobs.csv": a step's action and what it acted on, as one line of text. */
function stepLine(step: AgentStep): string {
  const { action, target } = stepWords(step);
  return target === '' ? action : `${action} ${target}`;
}

/**
 * The tools and skills an agent used. While it works, the header names the current step;
 * afterwards it says how long the work took. The list opens as the "Tool steps" setting says.
 * A table read shows the rows it read, and code shows what it gave back. In a team reply, each
 * time the lead asked a teammate is one step, which opens to the teammate's own.
 */
export function Steps({
  message,
  startOpen,
  waiting,
  onOpenPanel,
  onFlagConsultation,
}: StepsProps) {
  const listId = useId();
  const [choice, setChoice] = useState<boolean | null>(null);
  const working = message.status === 'streaming';
  const open = choice ?? startOpen;
  const step = working ? currentStep(message.steps) : undefined;
  // A teammate's answer is taught from once the reply has settled, like the reply itself.
  const onFlag = message.status === 'done' ? onFlagConsultation : undefined;

  // The header says what the work is, then how long it took; the steps themselves are one click
  // away. While a write waits for an answer, the line under the reply says so; this one counts.
  let header = workedLabel(message);
  if (working && waiting) header = `${stepCount(message.steps.length)} so far`;
  else if (step) header = stepLine(step);

  const version = message.graduateVersion;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex h-7 max-w-full items-center gap-2 self-start">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={listId}
          onClick={() => setChoice(!open)}
          className="flex min-w-0 items-center gap-2 rounded-mark text-ui text-fg transition-colors duration-150"
        >
          {working && !waiting && <Spinner size={13} />}
          <span className="truncate">{header}</span>
          <Chevron open={open} />
        </button>
        {version !== undefined && (
          <span className="flex items-center gap-0.5">
            <VersionTag version={version} className="h-6 min-w-8" />
            <span className="sr-only">Answered by version {version}</span>
            {/* No certificate covers an agent asking another (decision 100). */}
            {message.team && (
              <InfoTip about={`version ${version}`}>Not certified as a team</InfoTip>
            )}
          </span>
        )}
      </div>
      <Collapse open={open} id={listId}>
        <ol aria-label="Steps" className={STEP_LIST}>
          {message.steps.map((item) =>
            item.view?.kind === 'consult' ? (
              <ConsultRow
                key={item.id}
                step={item}
                view={item.view}
                consultation={message.consultations?.find((c) => c.stepId === item.id)}
                onOpenPanel={onOpenPanel}
                onFlag={onFlag}
              />
            ) : (
              <StepRow key={item.id} step={item} onOpenPanel={onOpenPanel} />
            ),
          )}
        </ol>
      </Collapse>
    </div>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <ChevronRight
      size={13}
      strokeWidth={1.8}
      aria-hidden
      className={cn('shrink-0 transition-transform duration-200', open && 'rotate-90')}
    />
  );
}

/** "Answered by version 2", and after it, for a teammate's answer, the flag that teaches it. */
function VersionLine({ children, end }: { children: ReactNode; end?: ReactNode }) {
  return (
    <li className={cn('flex items-center gap-2 text-fg', end ? 'py-0' : 'py-[5px]')}>
      <Layers size={13} strokeWidth={1.8} aria-hidden className="shrink-0" />
      {children}
      {end}
    </li>
  );
}

/** A step's words: its action, what it acted on, and its result in one line. */
function StepText({ step, meta }: { step: AgentStep; meta: string | undefined }) {
  const { action, target } = stepWords(step);
  return (
    <>
      <span className={NAME_TONE[step.status]}>{action}</span>
      {target !== '' && <span className="font-mono text-fg">{target}</span>}
      {meta && (
        <span className={step.status === 'error' ? 'ml-1.5 text-danger' : 'ml-1.5 text-fg'}>
          {meta}
        </span>
      )}
    </>
  );
}

/** One plain step: what it did, with the rows it read or the code it ran. */
function StepRow({
  step,
  onOpenPanel,
}: {
  step: AgentStep;
  onOpenPanel: (content: PanelContent) => void;
}) {
  // Code shows its own output, so its one-line summary would only repeat it.
  const meta = step.view?.kind === 'code' ? undefined : step.meta;
  return (
    <Reveal as="li" className="flex min-w-0 flex-col gap-2 py-[5px]">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <StepText step={step} meta={meta} />
      </div>
      {step.view && (
        <StepDetail
          view={step.view}
          title={step.detail}
          failed={step.status === 'error'}
          onOpenPanel={onOpenPanel}
        />
      )}
    </Reveal>
  );
}

/**
 * The lead asking a teammate (decision 100): "Asked Assay desk" and the first line of its answer,
 * or how it ended without one. It opens to what the lead asked, the teammate's own steps under a
 * hairline of their own, the version that answered, and a flag that teaches the teammate.
 */
function ConsultRow({
  step,
  view,
  consultation,
  onOpenPanel,
  onFlag,
}: {
  step: AgentStep;
  view: Extract<StepView, { kind: 'consult' }>;
  consultation: Consultation | undefined;
  onOpenPanel: (content: PanelContent) => void;
  onFlag: ((consultation: Consultation) => void) | undefined;
}) {
  const workId = useId();
  const [open, setOpen] = useState(false);
  const working = step.status === 'running';
  const answered = !working && (view.outcome ?? 'answered') === 'answered';
  const request = consultation?.request ?? step.detail;
  const answer = consultation ? answerText(consultation.text) : '';
  return (
    <Reveal as="li" className="flex min-w-0 flex-col py-[5px]">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={workId}
        onClick={() => setOpen(!open)}
        className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 self-start rounded-mark text-left"
      >
        {/* Whose work it is, at a glance: the teammate's avatar, as the sidebar shows it. */}
        <AgentAvatar name={step.name} className="size-5" />
        {/* Open, the whole answer shows below, so the first line beside the name goes. */}
        <StepText step={step} meta={open ? undefined : consultMeta(step)} />
        {working && <Spinner size={13} />}
        <Chevron open={open} />
      </button>
      <Collapse open={open} id={workId}>
        <ol aria-label={`${step.name}'s steps`} className={cn(STEP_LIST, 'mt-1.5')}>
          {request !== '' && (
            <li className="py-[5px] text-fg text-pretty">
              <q className="whitespace-pre-wrap break-words">{request}</q>
            </li>
          )}
          {view.steps.map((item) => (
            <StepRow key={item.id} step={item} onOpenPanel={onOpenPanel} />
          ))}
          {answer !== '' && (
            <li className="flex items-start gap-2 whitespace-pre-wrap break-words py-[5px] text-fg text-pretty">
              {/* An ask that failed, or was refused before the teammate began, says why. */}
              {view.outcome === 'error' && (
                <CircleAlert
                  size={13}
                  strokeWidth={2.2}
                  aria-label="Failed"
                  className="mt-[3px] shrink-0 text-danger"
                />
              )}
              <span className="min-w-0">{answer}</span>
            </li>
          )}
          {!working && (
            <VersionLine
              end={
                consultation &&
                onFlag && (
                  <FlagButton
                    label={`Flag ${step.name}'s answer for teaching`}
                    onFlag={() => onFlag(consultation)}
                  />
                )
              }
            >
              {answered ? 'Answered by' : 'Asked'} version {view.version}
            </VersionLine>
          )}
        </ol>
      </Collapse>
    </Reveal>
  );
}

function StepDetail({
  view,
  title,
  failed,
  onOpenPanel,
}: {
  view: StepView;
  title: string;
  failed: boolean;
  onOpenPanel: (content: PanelContent) => void;
}) {
  if (view.kind === 'code') {
    return <CodeView code={view.code} output={view.output} failed={failed} />;
  }
  // A consultation is a row of its own (ConsultRow), never a plain step's detail.
  if (view.kind === 'consult') return null;
  return <StepTable view={view} title={title} onOpenPanel={onOpenPanel} />;
}

/** The first rows a table read showed, with the rest a click away in the side panel. */
function StepTable({
  view,
  title,
  onOpenPanel,
}: {
  view: Extract<StepView, { kind: 'table' }>;
  title: string;
  onOpenPanel: (content: PanelContent) => void;
}) {
  const shown = view.rows.slice(0, STEP_TABLE_ROWS);
  const align = (column: number) => isFigureColumn(view.rows, column) && 'text-right';
  return (
    <div className="min-w-0 overflow-hidden rounded-control bg-field">
      <div className="overflow-x-auto px-3">
        <Table variant="plain" aria-label={title} className="text-small">
          <TableHeader>
            <TableRow>
              {view.columns.map((column, index) => (
                <TableHead key={column} className={cn('whitespace-nowrap', align(index))}>
                  {column}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((row, r) => (
              <TableRow key={r}>
                {view.columns.map((_, column) => (
                  <TableCell key={column} className={cn('whitespace-nowrap', align(column))}>
                    {cellText(row[column] ?? null)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {view.rows.length > STEP_TABLE_ROWS && (
        <button
          type="button"
          className="h-8 w-full border-t border-line text-small text-fg transition-colors duration-150 hover:bg-hover"
          onClick={() =>
            onOpenPanel({ kind: 'table', title, columns: view.columns, rows: view.rows })
          }
        >
          Show all {view.rows.length} rows
        </button>
      )}
    </div>
  );
}
