import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CodedError,
  DraftTurnSchema,
  RuleConfirmationStateSchema,
  TaskPlanSchema,
} from '@architect/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { connectEngine, type EngineClient } from '../src/host/client';
import { createEngineHost, type EngineHost } from '../src/host/engine-host';
import { createEngineDeps } from '../src/host/wiring';
import { FakeMentor } from './fakes/adapters';
import { portPair } from './fakes/ports';
import { shopData } from './support/drafting-data';
import { draft, question, TEACHER } from './support/drafting-world';
import { bikeShop, POLICY } from './support/rule-data';
import { bikeDraft } from './support/rule-draft';

/*
 * The drafting conversation as the app reaches it: through the engine host's port, with the
 * teacher passed on each call, the replies checked against their schemas and failures carrying
 * their codes.
 */

const data = shopData('host', 400, 150);
let root: string;
let host: EngineHost;
let client: EngineClient;
const mentor = new FakeMentor();

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'architect-drafting-host-'));
  mkdirSync(join(root, 'files'), { recursive: true });
  const deps = createEngineDeps({ dataDir: join(root, 'data'), getSecret: async () => undefined });
  host = await createEngineHost({
    dataDir: join(root, 'data'),
    deps: { ...deps, adapters: { ...deps.adapters, createMentor: () => mentor } },
  });
  const [hostPort, clientPort] = portPair();
  host.serve(hostPort);
  client = connectEngine(clientPort);
  mentor.requests.length = 0;
});

afterEach(async () => {
  client.close();
  await host.close();
  rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

function attach(name: string, content: string): string {
  const path = join(root, 'files', name);
  writeFileSync(path, content);
  return path;
}

describe('drafting through the engine host', () => {
  it('asks, drafts and shows the job and its tasks, each reply held to its schema', async () => {
    mentor.script = (_request, call) =>
      call === 1 ? question('Which region matters most?', ['North', 'South']) : draft();
    const files = [
      attach('customers.csv', data.customersCsv),
      attach('orders.csv', data.ordersCsv),
    ];

    const first = await client.jobs.draftStart('A desk for our shop', files, TEACHER);
    expect(DraftTurnSchema.safeParse(first).success).toBe(true);
    expect(first.options).toEqual(['North', 'South', 'Draft it now']);

    const second = await client.jobs.draftReply(first.sessionId, 'North', TEACHER);
    expect(DraftTurnSchema.safeParse(second).success).toBe(true);
    const job = second.draft;
    if (!job) throw new Error('Expected a draft.');

    // The job is in the library as an imported one is, and its plan is for the Define screen.
    expect(await client.jobs.get(job.id)).toEqual(job);
    expect(await client.jobs.list()).toMatchObject([{ id: job.id, taskCount: 120 }]);
    const plan = await client.jobs.taskPlan(job.id);
    expect(TaskPlanSchema.safeParse(plan).success).toBe(true);
    expect(plan.source).toBe('generated');
    expect(plan.counts).toEqual({ calibration: 10, train: 40, dev: 30, test: 40 });
    expect(plan.types.map((type) => type.id)).toEqual(['email', 'pending', 'totals']);

    // Saving it from Clarify changes nothing the job's tasks stand on.
    expect(await client.jobs.save(job)).toEqual(job);
    expect((await client.jobs.taskPlan(job.id)).counts).toEqual(plan.counts);
  });

  it('confirms a rule through the port, with the token the plan showed and the codes of a refusal', async () => {
    const bike = bikeShop({ offGrid: true });
    mentor.script = () => bikeDraft();
    const turn = await client.jobs.draftStart(
      'A repair desk',
      [
        attach('customers.csv', bike.customersCsv),
        attach('tickets.csv', bike.ticketsCsv),
        attach('policy.md', POLICY),
      ],
      TEACHER,
    );
    const job = turn.draft;
    if (!job) throw new Error('Expected a draft.');

    const plan = await client.jobs.taskPlan(job.id);
    expect(TaskPlanSchema.safeParse(plan).success).toBe(true);
    expect(plan.confirmation).toMatchObject({ state: 'needed' });
    expect(plan.types.find((type) => type.id === 'cost')?.details?.examples.length).toBeGreaterThan(
      2,
    );

    const stale = await client.jobs.confirmRules(job.id, 'old-token').catch((e: unknown) => e);
    expect(stale).toBeInstanceOf(CodedError);
    expect((stale as CodedError).code).toBe('rule_changed');

    const token = plan.confirmation?.token ?? '';
    const confirmed = await client.jobs.confirmRules(job.id, token);
    expect(RuleConfirmationStateSchema.safeParse(confirmed).success).toBe(true);
    expect(confirmed).toMatchObject({ state: 'confirmed', token });
    expect((await client.jobs.taskPlan(job.id)).confirmation).toMatchObject({
      state: 'confirmed',
      confirmedAt: confirmed.confirmedAt,
    });
  });

  it('refuses a run before the rule is confirmed, with its code', async () => {
    const bike = bikeShop({ offGrid: true });
    mentor.script = () => bikeDraft();
    const turn = await client.jobs.draftStart(
      'A repair desk',
      [
        attach('customers.csv', bike.customersCsv),
        attach('tickets.csv', bike.ticketsCsv),
        attach('policy.md', POLICY),
      ],
      TEACHER,
    );
    const refused = await client.runs
      .start(turn.draft?.id ?? '', { method: 'bare' })
      .catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(CodedError);
    expect((refused as CodedError).code).toBe('rule_unconfirmed');
  });

  it('carries a lost conversation with its code, and a plan for a job that is not there', async () => {
    const lost = await client.jobs
      .draftReply('drf_gone', 'North', TEACHER)
      .catch((e: unknown) => e);
    expect(lost).toBeInstanceOf(CodedError);
    expect((lost as CodedError).code).toBe('draft_not_found');
    const missing = await client.jobs.taskPlan('job_missing').catch((e: unknown) => e);
    expect((missing as CodedError).code).toBe('job_not_found');
  });

  it('passes on what is wrong with a file in a sentence a person can act on', async () => {
    await expect(
      client.jobs.draftStart('A desk', [attach('orders.xlsx', 'PK')], TEACHER),
    ).rejects.toThrow('orders.xlsx is a spreadsheet.');
  });
});
