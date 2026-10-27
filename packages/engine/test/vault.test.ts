import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GuardError, type Task } from '@architect/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isMentorReleased, releaseMentor, type MentorReleased } from '../src/vault/gate';
import { Vault } from '../src/vault/vault';

const INVOICE_FORMAT = 'End with: ANSWER: {"invoice_id": "<id>", "total_cents": <integer>}';
const OVERDUE_FORMAT = 'End with: ANSWER: {"customer_id": "<id>", "overdue_cents": <integer>}';

function invoiceTask(id: string, job: string, technician: string): Task {
  return {
    id,
    type: 'invoice',
    family: id,
    prompt: `Job ${job} is finished; ${technician} worked on it after hours. Create its invoice in invoices.csv.\n${INVOICE_FORMAT}`,
    expected: { kind: 'end_state', validator: 'invoice_created', params: { job } },
  };
}

function overdueTask(id: string, customer: string): Task {
  return {
    id,
    type: 'overdue',
    family: id,
    prompt: `How much does customer ${customer} owe past the due date as of 2026-11-03? ${OVERDUE_FORMAT}`,
    expected: { kind: 'answer', value: { customer_id: customer }, compare: { mode: 'exact' } },
  };
}

const tests = [
  invoiceTask('inv-test-1', 'W-2291', 'Rosa Delgado'),
  invoiceTask('inv-test-2', 'W-3307', 'Marcus Webb'),
  overdueTask('ovd-test-1', 'C-0412'),
  { ...overdueTask('brief-test', 'C-7788'), prompt: 'Total owed by C-7788 today?' },
  { ...overdueTask('short-test', 'C1'), prompt: 'Overdue for C1?' },
];
const others = [
  invoiceTask('inv-train-1', 'W-1001', 'Ana Silva'),
  invoiceTask('inv-train-2', 'W-1002', 'Rosa Delgado'),
  invoiceTask('inv-dev-1', 'W-1003', 'Marcus Webb'),
  overdueTask('ovd-train-1', 'C-0100'),
  overdueTask('ovd-dev-1', 'C-0101'),
];

let root: string;
let vault: Vault;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'architect-vault-'));
  vault = new Vault(root);
  vault.seal('job_sample', tests, others);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const session = () => ({ dispose: vi.fn(async () => undefined) });

describe('sealing', () => {
  it('seals once and refuses to seal again until reset', () => {
    expect(vault.isSealed('job_sample')).toBe(true);
    expect(vault.count('job_sample')).toBe(5);
    expect(() => vault.seal('job_sample', tests, others)).toThrow(GuardError);
    vault.reset('job_sample');
    expect(vault.isSealed('job_sample')).toBe(false);
    expect(vault.count('job_sample')).toBe(0);
    vault.seal('job_sample', tests.slice(0, 2), others);
    expect(vault.count('job_sample')).toBe(2);
  });

  it('keeps each job in its own folder under the vault', () => {
    expect(
      readFileSync(join(root, 'vault', 'job_sample', 'test.jsonl'), 'utf8').split('\n'),
    ).toHaveLength(6);
    expect(vault.isSealed('job_other')).toBe(false);
    expect(() => vault.isSealed('../job_sample')).toThrow(/not a valid job id/);
  });

  it('refuses a task that is in the test split and another split', () => {
    expect(() => vault.seal('job_twice', tests, [...others, tests[0] as Task])).toThrow(
      'Task inv-test-1 is in the test split and in another split.',
    );
  });
});

describe('leak detection', () => {
  it('finds a test prompt in a serialized mentor payload', () => {
    const payload = JSON.stringify({
      train: { results: [{ prompt: others[0]?.prompt }, { prompt: tests[0]?.prompt }] },
    });
    expect(vault.leakDetector('job_sample').scan(payload)).toEqual({
      leaked: true,
      matchedIds: ['inv-test-1'],
    });
  });

  it('finds a partial copy and ignores case, spacing and punctuation', () => {
    const detector = vault.leakDetector('job_sample');
    expect(
      detector.scan('the student kept failing job w 3307 is finished marcus webb worked on it')
        .matchedIds,
    ).toEqual(['inv-test-2']);
    expect(
      detector.scan('HOW MUCH does customer   C-0412 owe past the due date').matchedIds,
    ).toEqual(['ovd-test-1']);
  });

  it('does not flag train or dev prompts that share the test prompts templates', () => {
    const detector = vault.leakDetector('job_sample');
    const payload = JSON.stringify({
      prompts: others.map((task) => task.prompt),
      harness: {
        'system.md': `Always finish with the ANSWER line. ${INVOICE_FORMAT} ${OVERDUE_FORMAT}`,
      },
      note: 'Rosa Delgado and Marcus Webb worked on several after hours jobs.',
    });
    expect(detector.scan(payload)).toEqual({ leaked: false, matchedIds: [] });
  });

  it('matches a short but specific prompt whole, and ignores prompts too short to be specific', () => {
    const detector = vault.leakDetector('job_sample');
    expect(detector.scan('Ask: "Total owed by C-7788 today?"').matchedIds).toEqual(['brief-test']);
    expect(detector.scan('Is anything overdue for C1?').leaked).toBe(false);
  });

  it('reports ids only, never test content', () => {
    const result = vault.leakDetector('job_sample').scan(tests[2]?.prompt ?? '');
    expect(Object.keys(result).sort()).toEqual(['leaked', 'matchedIds']);
    expect(JSON.stringify(result)).not.toMatch(/C-0412|owe|customer/i);
  });

  it('needs a sealed split', () => {
    expect(() => vault.leakDetector('job_unsealed')).toThrow(GuardError);
  });
});

describe('the locked test', () => {
  it('opens only after the mentor is released', async () => {
    expect(() =>
      vault.openForLockedTest('job_sample', undefined as unknown as MentorReleased),
    ).toThrow(GuardError);
    const mentor = session();
    const proof = await releaseMentor(mentor);
    expect(mentor.dispose).toHaveBeenCalledOnce();
    expect(isMentorReleased(proof)).toBe(true);
    expect(vault.openForLockedTest('job_sample', proof)).toEqual(tests);
  });

  it('cannot be opened with a forged proof', async () => {
    const cast = {} as MentorReleased;
    expect(() => vault.openForLockedTest('job_sample', cast)).toThrow(
      'The locked test opens only after the mentor has been released.',
    );
    const real = await releaseMentor(session());
    const brand = Object.getOwnPropertySymbols(real)[0] as symbol;
    const copied = { [brand]: true, releasedAt: real.releasedAt } as unknown as MentorReleased;
    expect(() => vault.openForLockedTest('job_sample', copied)).toThrow(GuardError);
    expect(Object.isFrozen(real)).toBe(true);
  });

  it('issues no proof when the mentor fails to dispose', async () => {
    const failing = { dispose: async () => Promise.reject(new Error('still connected')) };
    await expect(releaseMentor(failing)).rejects.toThrow('still connected');
  });

  it('refuses a test file that changed after sealing', async () => {
    const file = join(root, 'vault', 'job_sample', 'test.jsonl');
    writeFileSync(file, readFileSync(file, 'utf8').replace('W-2291', 'W-2292'));
    const proof = await releaseMentor(session());
    expect(() => vault.openForLockedTest('job_sample', proof)).toThrow(
      'The locked test of job job_sample changed after it was sealed.',
    );
  });
});
