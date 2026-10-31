import type { GraduateManifest, WorkspaceMessage } from '@architect/shared';
import { describe, expect, it } from 'vitest';
import {
  cellText,
  currentStep,
  inSentence,
  isFigureColumn,
  isTotalRow,
  listInSentence,
  answerText,
  consultMeta,
  namesInSentence,
  previewRows,
  stepWords,
  suggestionsFor,
  taskTypeLabel,
  workedLabel,
  WRITE_MODE_LABELS,
  WRITE_MODE_MEANINGS,
  WRITE_MODES,
  WRITE_SETTING,
} from '../../../src/renderer/src/workspace/labels';

const message = (patch: Partial<WorkspaceMessage>): WorkspaceMessage => ({
  id: 'msg_1',
  chatId: 'cht_1',
  role: 'agent',
  createdAt: '2026-10-27T15:00:00.000Z',
  text: '',
  steps: [],
  blocks: [],
  status: 'done',
  ...patch,
});

const step = (id: string, status: 'running' | 'done', ms?: number) => ({
  id,
  kind: 'tool' as const,
  name: 'read',
  detail: `data/${id}.csv`,
  status,
  ...(ms === undefined ? {} : { ms }),
});

describe('workspace labels', () => {
  it('names and explains every write mode the composer offers', () => {
    expect(WRITE_SETTING).toBe('Saving files');
    expect(WRITE_MODES).toEqual(['ask', 'allow', 'never']);
    for (const mode of WRITE_MODES) {
      expect(WRITE_MODE_LABELS[mode]).not.toBe('');
      expect(WRITE_MODE_MEANINGS[mode]).not.toBe('');
    }
  });

  it('says each step plainly, tools written in training included', () => {
    const step = (
      name: string,
      kind: 'tool' | 'skill',
      status: 'done' | 'running',
      detail = 'data/jobs.csv',
    ) => ({ id: name, kind, name, detail, status }) as const;
    expect(stepWords(step('read', 'tool', 'done'))).toEqual({
      action: 'Read',
      target: 'data/jobs.csv',
    });
    expect(
      ['ls', 'glob', 'grep', 'write', 'edit', 'append', 'run'].map((name) => [
        stepWords(step(name, 'tool', 'running')).action,
        stepWords(step(name, 'tool', 'done')).action,
      ]),
    ).toEqual([
      ['Listing', 'Listed'],
      ['Finding', 'Found'],
      ['Searching', 'Searched'],
      ['Writing', 'Wrote'],
      ['Editing', 'Edited'],
      ['Adding to', 'Added to'],
      ['Running code', 'Ran code'],
    ]);
    expect(stepWords(step('ls', 'tool', 'done', 'your folders'))).toEqual({
      action: 'Listed your folders',
      target: '',
    });
    expect(stepWords(step('price-a-job', 'skill', 'running')).action).toBe('Loading the skill');
    expect(stepWords(step('invoice_total', 'tool', 'done')).action).toBe(
      'Ran the tool invoice_total',
    );
  });

  it('says a reply waits for the GPU in plain words, in one line', () => {
    const waiting = {
      id: 'step-gpu',
      kind: 'wait',
      name: 'gpu',
      detail: 'Waiting for the GPU: Architect is checking an agent on this computer',
      status: 'running',
    } as const;
    expect(stepWords(waiting)).toEqual({
      action: 'Waiting: your computer is busy with another job.',
      target: '',
    });
    expect(currentStep([step('a', 'done'), waiting])).toBe(waiting);
  });

  it('keeps the words of the table tools that stored chats name', () => {
    const old = (name: string) =>
      stepWords({ id: name, kind: 'tool', name, detail: 'jobs.csv', status: 'done' }).action;
    expect(
      ['read_table', 'read_text', 'list_files', 'append_rows', 'update_rows', 'calculate'].map(old),
    ).toEqual(['Read', 'Read', 'Listed', 'Added rows to', 'Updated', 'Calculated']);
  });

  it('says how long the agent worked', () => {
    expect(workedLabel(message({ workedMs: 3200 }))).toBe('Worked for 3 s');
    expect(workedLabel(message({ workedMs: 200 }))).toBe('Worked for 1 s');
    expect(workedLabel(message({ workedMs: 72_000 }))).toBe('Worked for 1 min 12 s');
    expect(workedLabel(message({ workedMs: 120_000 }))).toBe('Worked for 2 min');
    expect(workedLabel(message({ steps: [step('a', 'done', 900), step('b', 'done', 1300)] }))).toBe(
      'Worked for 2 s',
    );
    expect(workedLabel(message({ steps: [step('a', 'done'), step('b', 'done')] }))).toBe('2 steps');
  });

  it('lines up a column on the right only when every filled cell is a figure', () => {
    const rows = [
      ['Labor', '$300.00', 12, '95%', 'J-4471'],
      ['Plan discount', '−$116.76', null, '+3', 'Thu 10:00'],
      ['Total', '$1,116.52', 4, '', 'INV-4473'],
    ];
    expect([0, 1, 2, 3, 4].map((column) => isFigureColumn(rows, column))).toEqual([
      false,
      true,
      true,
      true,
      false,
    ]);
    expect(isFigureColumn([[null], ['']], 0)).toBe(false);
  });

  it('names the running step, else the latest', () => {
    expect(currentStep([step('a', 'done'), step('b', 'running')])?.id).toBe('b');
    expect(currentStep([step('a', 'done'), step('b', 'done')])?.id).toBe('b');
    expect(currentStep([])).toBeUndefined();
  });

  it('puts labels mid-sentence without breaking acronyms', () => {
    expect(inSentence('Overdue balances')).toBe('overdue balances');
    expect(inSentence('VAT returns')).toBe('VAT returns');
    expect(inSentence('Refunds')).toBe('refunds');
  });

  it('spots the row that sums a table', () => {
    expect(isTotalRow(['Total', '$486.20'])).toBe(true);
    expect(isTotalRow([' grand total ', 12])).toBe(true);
    expect(isTotalRow(['Totals'])).toBe(true);
    expect(isTotalRow(['Subtotal', '$450.00'])).toBe(false);
    expect(isTotalRow([48620, 'Total'])).toBe(false);
    expect(isTotalRow([])).toBe(false);
  });

  it('keeps a closing total row in a table preview', () => {
    const rows = [['Labor'], ['Parts'], ['Trip fee'], ['Discount'], ['Tax'], ['Total']];
    expect(previewRows(rows, 4)).toEqual([['Labor'], ['Parts'], ['Trip fee'], ['Total']]);
    expect(previewRows(rows.slice(0, 5), 4)).toEqual(rows.slice(0, 4));
    expect(previewRows(rows.slice(0, 3), 4)).toEqual(rows.slice(0, 3));
  });

  it('lists labels the way a sentence does', () => {
    expect(listInSentence(['Invoices', 'Overdue balances', 'Scheduling'])).toBe(
      'invoices, overdue balances or scheduling',
    );
    expect(listInSentence(['Invoices', 'VAT returns'], 'and')).toBe('invoices and VAT returns');
    expect(listInSentence(['Invoices'])).toBe('invoices');
    expect(listInSentence([])).toBe('');
  });

  it('writes table cells for people', () => {
    expect([cellText(null), cellText(true), cellText(false), cellText(48620)]).toEqual([
      '',
      'Yes',
      'No',
      '48620',
    ]);
  });

  it('suggests the task types the agent handles, and names refused ones', () => {
    const manifest = {
      test: {
        perType: [
          { type: 'invoice', label: 'Price a finished job', pass: 19, total: 20, refused: false },
          { type: 'refunds', label: 'Refunds', pass: 0, total: 4, refused: true },
          { type: 'overdue', label: 'Who owes us money?', pass: 20, total: 20, refused: false },
          {
            type: 'schedule',
            label: 'Book the next free slot',
            pass: 16,
            total: 20,
            refused: false,
          },
          { type: 'extra', label: 'Fourth', pass: 1, total: 1, refused: false },
        ],
      },
    } as unknown as GraduateManifest;
    expect(suggestionsFor(manifest)).toEqual([
      'Price a finished job',
      'Who owes us money?',
      'Book the next free slot',
    ]);
    expect(taskTypeLabel(manifest, 'refunds')).toBe('Refunds');
    expect(taskTypeLabel(manifest, 'warranty_claims')).toBe('Warranty claims');
    expect(
      suggestionsFor(manifest, [
        {
          id: 'invoice',
          label: 'Invoices',
          description: 'Price a finished job and add its invoice',
        },
        { id: 'refunds', label: 'Refunds', description: 'Refund a charge' },
      ]),
    ).toEqual([
      'Price a finished job and add its invoice',
      'Who owes us money?',
      'Book the next free slot',
    ]);
  });
});

describe('consultation words', () => {
  const consult = (
    status: 'running' | 'done' | 'error',
    outcome?: 'answered' | 'refused' | 'no_answer' | 'error' | 'stopped' | 'out_of_steps',
  ) => ({
    id: 'step-2',
    kind: 'consult' as const,
    name: 'Assay desk',
    detail: 'Which compounds need a re-test this week, and why?',
    meta: 'Three compounds from FW-0417.',
    status,
    view: {
      kind: 'consult' as const,
      graduateId: 'grd_assay',
      version: 2,
      steps: [],
      ...(outcome === undefined ? {} : { outcome }),
    },
  });

  it('asks and has asked the teammate by name', () => {
    expect(stepWords(consult('running'))).toEqual({ action: 'Asking Assay desk', target: '' });
    expect(stepWords(consult('done', 'answered'))).toEqual({
      action: 'Asked Assay desk',
      target: '',
    });
  });

  it("says the answer's first line, or how the teammate ended without one", () => {
    expect(consultMeta(consult('running'))).toBeUndefined();
    expect(consultMeta(consult('done', 'answered'))).toBe('Three compounds from FW-0417.');
    expect(consultMeta(consult('done', 'refused'))).toBe("Doesn't handle this");
    expect(consultMeta(consult('done', 'no_answer'))).toBe('Gave no answer');
    expect(consultMeta(consult('error', 'error'))).toBe('Stopped with an error');
    expect(consultMeta(consult('done', 'stopped'))).toBe('Stopped');
    expect(consultMeta(consult('done', 'out_of_steps'))).toBe('Ran out of steps');
    // Saved before outcomes were kept: a failed step failed, any other answered.
    expect(consultMeta(consult('error'))).toBe('Stopped with an error');
    expect(consultMeta(consult('done'))).toBe('Three compounds from FW-0417.');
  });

  it("keeps a teammate's words and drops the ANSWER line its task ends with", () => {
    expect(answerText('FW-0418 passes QC.\nBoth are queued.\nANSWER: {"retests": 2}')).toBe(
      'FW-0418 passes QC.\nBoth are queued.',
    );
    expect(answerText('ANSWER: {"retests": 0}')).toBe('');
  });

  it('joins names as written', () => {
    expect(namesInSentence(['Assay desk'])).toBe('Assay desk');
    expect(namesInSentence(['Assay desk', 'Sweep desk', 'VAT desk'])).toBe(
      'Assay desk, Sweep desk and VAT desk',
    );
  });
});
