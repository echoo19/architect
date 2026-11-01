import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Trace } from '@architect/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { attemptEpisodes, loadPassedAttempts, type PassedAttempt } from '../src/field/attempts';
import { fieldDataset, FieldDatasetError } from '../src/field/dataset';
import { buildFieldExport, storedFieldSource } from '../src/field/export';
import { openEngineStore } from '../src/store/engine-store';
import { toolSpecs } from '../src/tools/toolbox';
import {
  PASSED_RUN,
  passedAttemptsWorld,
  type PassedAttemptsWorld,
} from './support/passed-attempts';

let root: string;
/** The Academy desk with two passing train attempts, allowed to train off this computer. */
let shared: PassedAttemptsWorld;
/** The same, as the Academy desk ships: its data stays on this computer. */
let kept: PassedAttemptsWorld;

async function loaded(world: PassedAttemptsWorld): Promise<PassedAttempt[]> {
  const store = openEngineStore(world.paths.database);
  try {
    return await loadPassedAttempts(store, world.paths, world.job, world.train);
  } finally {
    store.close();
  }
}

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'architect-field-attempts-'));
  shared = await passedAttemptsWorld(join(root, 'shared'), { count: 2, remoteTraining: true });
  kept = await passedAttemptsWorld(join(root, 'kept'), { count: 1, remoteTraining: false });
}, 60_000);

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("the student's passing train attempts as demonstrations", () => {
  it("are read from the job's runs: passing train attempts only, never failed or dev ones", async () => {
    const items = await loaded(shared);
    expect(items.map((item) => item.attempt.id)).toEqual(['att_pass0', 'att_pass1']);
    const [first] = items;
    expect(first?.harness?.meta.hash).toBe(shared.harness.meta.hash);
    expect(first?.dataHashes).toEqual((first?.trace as Trace).replay?.data);
    // The Academy desk may append to its staff notes, so the write tools were offered.
    expect(first?.writable).toBe(true);
  });

  it('become episodes whose targets skip the turn whose tool call failed', async () => {
    const [item] = await loaded(shared);
    const { episodes, leftOut } = attemptEpisodes(shared.job, [item!]);
    expect(leftOut).toEqual([]);
    const [episode] = episodes;
    const trace = item!.trace as Trace;
    const assistant = trace.messages.flatMap((message, index) =>
      message.role === 'assistant' ? [index] : [],
    );
    expect(assistant).toHaveLength(3);
    // The first call read a file that isn't there: it is context, not a target.
    expect(episode?.verifiedTurns).toEqual(assistant.slice(1));
    expect(episode).toMatchObject({
      id: 'att_pass0',
      kind: 'passed_attempt',
      category: 'diagnose',
      origin: { kind: 'task', taskId: item!.attempt.taskId, split: 'train' },
      tools: toolSpecs(shared.harness, true),
      check: { pass: true },
      template: {
        reasoningStrength: shared.harness.decoding.thinking,
        currentDate: trace.replay!.today,
      },
      provenance: {
        jobId: shared.job.id,
        runId: PASSED_RUN,
        attemptId: 'att_pass0',
        studentModel: 'scripted-student',
      },
      sharing: { remoteTraining: true },
    });
    expect(Object.values(episode!.provenance.inputHashes ?? {})[0]).toMatch(/^[0-9a-f]{64}$/);
    // Without the job's leave to train off this computer, the episode says so.
    expect(attemptEpisodes(kept.job, [item!]).episodes[0]?.sharing.remoteTraining).toBe(false);
  });

  it('leaves out an attempt whose conversation may not be what the student read', async () => {
    const [item] = await loaded(shared);
    const trace = item!.trace as Trace;
    const cases: [PassedAttempt, string][] = [
      [{ ...item!, trace: { nonsense: true } }, "its trace can't be read"],
      [
        { ...item!, attempt: { ...item!.attempt, taskId: 'copperfield-diagnose-99' } },
        'its trace is not of task copperfield-diagnose-99',
      ],
      [{ ...item!, trace: { ...trace, taskId: undefined } }, 'its trace is not of task'],
      [{ ...item!, trace: { ...trace, replay: undefined } }, 'made before traces recorded'],
      [{ ...item!, harness: null }, "isn't the one it ran with"],
      [
        {
          ...item!,
          harness: { ...shared.harness, meta: { ...shared.harness.meta, hash: 'sha256-other' } },
        },
        "isn't the one it ran with",
      ],
      [{ ...item!, dataHashes: { 'data/policy.md': 'sha256-0' } }, 'files have changed'],
      [
        {
          ...item!,
          trace: { ...trace, cleared: [{ turn: 2, callId: 'c', name: 'read', stub: '…' }] },
        },
        'taken out of its view',
      ],
    ];
    for (const [given, why] of cases) {
      const { episodes, leftOut } = attemptEpisodes(shared.job, [given]);
      expect(episodes, why).toEqual([]);
      expect(leftOut).toHaveLength(1);
      expect(leftOut[0]?.what).toBe('attempt att_pass0');
      expect(leftOut[0]?.why).toContain(why);
    }
  });

  it("refuses a row whose trace file is another task's", async () => {
    const [first, second] = await loaded(shared);
    // The second row's path leads to the first attempt's trace.
    const swapped = { ...second!, trace: first!.trace };
    const { episodes, leftOut } = attemptEpisodes(shared.job, [first!, swapped]);
    expect(episodes.map((episode) => episode.id)).toEqual(['att_pass0']);
    expect(leftOut).toEqual([
      { what: 'attempt att_pass1', why: `its trace is not of task ${second!.attempt.taskId}` },
    ]);
  });
});

describe('what a training job off this computer trains on', () => {
  it("is the exporter's own dataset, built from the job's records in the data folder", async () => {
    const { dataset, manifest } = await fieldDataset(shared.paths.root, 'Academy desk');
    expect(manifest.job.id).toBe(shared.job.id);
    expect(dataset.manifest).toMatchObject({
      example_count: 2,
      trained_turns: 4,
      remote_training_allowed: true,
      kinds: { passed_attempt: 2 },
      categories: { diagnose: 2 },
    });
    // The same examples an export writes, without the export's verdicts and uses.
    const exported = buildFieldExport(await storedFieldSource(shared.paths.root, shared.job.id));
    expect(exported.dataset?.jsonl).toBe(dataset.jsonl);
    expect(dataset.jsonl).not.toContain('permitted_uses');
  });

  it("is refused when the job's data may not leave this computer", async () => {
    await expect(fieldDataset(kept.paths.root, kept.job.id)).rejects.toThrow(FieldDatasetError);
    await expect(fieldDataset(kept.paths.root, kept.job.id)).rejects.toThrow(
      'has no demonstrations to train on off this computer: its data may not leave this computer',
    );
    await expect(fieldDataset(kept.paths.root, 'nobody')).rejects.toMatchObject({
      code: 'job_not_found',
    });
  });
});
