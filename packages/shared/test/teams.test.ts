import { describe, expect, it } from 'vitest';
import {
  ASK_TEAMMATE,
  AgentStepSchema,
  ApprovalRequestSchema,
  CorrectionRequestSchema,
  describeCall,
  describeResult,
  isReservedToolName,
  TeamInputSchema,
  TeamSchema,
  WorkspaceChatSchema,
  WorkspaceMessageSchema,
} from '../src';

const AT = '2026-10-31T09:00:00.000Z';

const TEAM = {
  id: 'team_lab1',
  name: 'Lab review',
  members: [
    { graduateId: 'grd_assay' },
    { graduateId: 'grd_sweep', role: "Reads Halden Lab's training sweeps" },
  ],
  createdAt: AT,
  updatedAt: AT,
};

/** A message as it was saved before teams. */
const OLD_MESSAGE = {
  id: 'msg_1',
  chatId: 'cht_1',
  role: 'agent',
  createdAt: AT,
  text: 'Done.',
  steps: [{ id: 'step-1', kind: 'tool', name: 'read', detail: 'data/plates.csv', status: 'done' }],
  blocks: [
    {
      kind: 'approval',
      changeId: 'chg_1',
      op: 'append',
      file: 'data/retests.csv',
      summary: 'Add 1 row to data/retests.csv',
      status: 'approved',
    },
  ],
  status: 'done',
  graduateVersion: 1,
};

const leaf = (id: string) => ({
  id,
  kind: 'tool',
  name: 'read',
  detail: 'data/runs.csv',
  status: 'done',
});

describe('team contracts', () => {
  it('takes a lead and up to three teammates, each once', () => {
    expect(TeamSchema.parse(TEAM).members).toHaveLength(2);
    expect(TeamInputSchema.safeParse({ name: 'Solo', members: [TEAM.members[0]] }).success).toBe(
      false,
    );
    const five = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ graduateId: `grd_${id}` }));
    expect(TeamInputSchema.safeParse({ name: 'Crowd', members: five }).success).toBe(false);
    const twice = [{ graduateId: 'grd_a' }, { graduateId: 'grd_a' }];
    expect(TeamInputSchema.safeParse({ name: 'Echo', members: twice }).success).toBe(false);
    expect(TeamInputSchema.safeParse({ name: 'Lab review', members: TEAM.members }).success).toBe(
      true,
    );
  });

  it('nests a teammate’s plain steps in a consultation, and nothing deeper', () => {
    const consult = {
      id: 'step-2',
      kind: 'consult',
      name: 'Sweep desk',
      detail: 'Did warmup help on sw-11?',
      status: 'done',
      view: { kind: 'consult', graduateId: 'grd_sweep', version: 2, steps: [leaf('step-1')] },
    };
    expect(AgentStepSchema.parse(consult).view?.kind).toBe('consult');
    const deeper = {
      ...consult,
      view: { ...consult.view, steps: [{ ...consult, id: 'step-1' }] },
    };
    expect(AgentStepSchema.safeParse(deeper).success).toBe(false);
    const settled = { ...consult, view: { ...consult.view, outcome: 'answered' } };
    expect(AgentStepSchema.parse(settled).view).toMatchObject({ outcome: 'answered' });
  });

  it('shows a teammate’s work on a consultation and on nothing else', () => {
    const { view } = AgentStepSchema.parse({
      id: 'step-2',
      kind: 'consult',
      name: 'Sweep desk',
      detail: 'Did warmup help?',
      status: 'running',
      view: { kind: 'consult', graduateId: 'grd_sweep', version: 1, steps: [] },
    });
    expect(AgentStepSchema.safeParse({ ...leaf('step-1'), view }).success).toBe(false);
    const bare = { ...leaf('step-2'), kind: 'consult' };
    expect(AgentStepSchema.safeParse(bare).success).toBe(false);
  });

  it('still reads messages and chats saved before teams', () => {
    const message = WorkspaceMessageSchema.parse(OLD_MESSAGE);
    expect(message.consultations).toBeUndefined();
    const chat = WorkspaceChatSchema.parse({
      id: 'cht_1',
      graduateId: 'grd_assay',
      title: 'QC',
      createdAt: AT,
      updatedAt: AT,
      running: false,
      waiting: false,
    });
    expect(chat.teamId).toBeUndefined();
  });

  it('keeps a reply’s consultations and names the teammate a write is for', () => {
    const agent = { graduateId: 'grd_sweep', name: 'Sweep desk' };
    const message = WorkspaceMessageSchema.parse({
      ...OLD_MESSAGE,
      blocks: [{ ...OLD_MESSAGE.blocks[0], agent }],
      consultations: [
        {
          stepId: 'step-2',
          graduateId: 'grd_sweep',
          version: 2,
          request: 'Did warmup help on sw-11?',
          work: [{ kind: 'model', text: 'ANSWER: helped', calls: [] }],
          text: 'ANSWER: helped',
        },
      ],
    });
    expect(message.consultations?.[0]?.version).toBe(2);
    expect(message.blocks[0]).toMatchObject({ agent });
    const approval = ApprovalRequestSchema.parse({
      changeId: 'chg_2',
      tool: 'append',
      file: 'data/proposed_runs.csv',
      summary: 'Add 2 rows to data/proposed_runs.csv',
      agent,
    });
    expect(approval.agent).toEqual(agent);
  });

  it('lets a correction name the consultation it flags', () => {
    const request = CorrectionRequestSchema.parse({
      wrong: 'The interval is wrong.',
      step: 'step-2',
      consent: true,
    });
    expect(request.step).toBe('step-2');
  });

  it('reserves the teammate tool’s name and describes its calls', () => {
    expect(isReservedToolName(ASK_TEAMMATE)).toBe(true);
    expect(isReservedToolName('read')).toBe(true);
    expect(isReservedToolName('overdue_invoices')).toBe(false);
    const args = { member: 'Sweep desk', request: 'Did warmup help on sw-11?' };
    expect(describeCall(ASK_TEAMMATE, args)).toBe('Did warmup help on sw-11?');
    expect(describeResult(ASK_TEAMMATE, 'It helped.\nANSWER: helped')).toBe('It helped.');
  });
});
