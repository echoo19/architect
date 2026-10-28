import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GuardError, type VerifiedEpisode } from '@architect/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildTrainingDataset,
  DatasetError,
  readTrainingDataset,
  writeTrainingDataset,
} from '../src/training';
import { orderEpisode } from './support/episodes';

const NOW = () => new Date('2026-10-28T10:00:00.000Z');
const remote = { destination: 'remote' as const, now: NOW };

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'architect-dataset-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('the training dataset', () => {
  it('trains only on the verified turns, in the chat format the trainer reads', () => {
    const built = buildTrainingDataset([orderEpisode('ep-1')], remote);
    const [example] = built.examples;
    expect(example?.messages.map((message) => [message.role, message.train])).toEqual([
      ['system', false],
      ['user', false],
      ['assistant', false],
      ['tool', false],
      ['assistant', true],
    ]);
    expect(example?.messages[2]).toEqual({
      role: 'assistant',
      content: '',
      tool_calls: [
        {
          id: 'call_1',
          type: 'function',
          function: { name: 'read', arguments: { path: 'data/orders.csv' } },
        },
      ],
      train: false,
    });
    expect(example?.messages[3]).toMatchObject({
      role: 'tool',
      tool_call_id: 'call_1',
      name: 'read',
    });
    expect(example?.messages[4]).toMatchObject({
      reasoning_content: 'Delivered on the 19th, promised the 20th.',
      train: true,
    });
    expect(example?.tools.map((tool) => tool.function.name)).toEqual(['read', 'run']);
    expect(example?.chat_template_kwargs).toEqual({
      reasoning_strength: 'low',
      current_date: '2026-11-24',
    });
    expect(example?.provenance).toMatchObject({
      origin: 'task ord-train-1182 (train)',
      attempt_id: 'att_ep-1',
      replay_from_step: 2,
      check_reason: 'The answer matches the order record.',
    });
    expect(built.manifest).toMatchObject({
      format: 'architect.chat-dataset/1',
      example_count: 1,
      trained_turns: 1,
      categories: { orders: 1 },
      kinds: { replay_correction: 1 },
      remote_training_allowed: true,
      excluded: [],
    });
  });

  it('writes the same bytes for the same episodes, in any order', () => {
    const episodes = [orderEpisode('ep-b', {}, '2001'), orderEpisode('ep-a', {}, '1182')];
    const first = buildTrainingDataset(episodes, remote);
    const second = buildTrainingDataset([...episodes].reverse(), remote);
    expect(second.jsonl).toBe(first.jsonl);
    expect(second.manifest.examples_sha256).toBe(first.manifest.examples_sha256);
    expect(first.examples.map((example) => example.id)).toEqual(['ep-a', 'ep-b']);

    writeTrainingDataset(dir, first);
    const read = readTrainingDataset(dir);
    expect(read.examples).toEqual(first.examples);
    expect(readFileSync(join(dir, 'examples.jsonl'), 'utf8').split('\n')).toHaveLength(3);
  });

  it('notices an examples file changed after it was written', () => {
    writeTrainingDataset(dir, buildTrainingDataset([orderEpisode('ep-1')], remote));
    const file = join(dir, 'examples.jsonl');
    writeFileSync(file, readFileSync(file, 'utf8').replace('1182', '1183'));
    expect(() => readTrainingDataset(dir)).toThrow("doesn't match the dataset's manifest");
  });

  it('leaves out what it cannot train on, and says why', () => {
    const base = orderEpisode('base');
    const assistantTwice: VerifiedEpisode = {
      ...base,
      id: 'twice',
      messages: [...base.messages, { role: 'assistant', content: 'Anything else?' }],
    };
    const unanswered: VerifiedEpisode = {
      ...base,
      id: 'unanswered',
      messages: base.messages.slice(0, 3),
      verifiedTurns: [2],
    };
    const unoffered: VerifiedEpisode = {
      ...base,
      id: 'unoffered',
      messages: base.messages.map((message, index) =>
        index === 2 && message.role === 'assistant'
          ? { ...message, toolCalls: [{ id: 'call_1', name: 'write', arguments: {} }] }
          : message,
      ),
    };
    const built = buildTrainingDataset(
      [
        base,
        orderEpisode('failed', { check: { pass: false, reason: 'Wrong order.' } }, '3003'),
        orderEpisode('private', { sharing: { remoteTraining: false } }, '4004'),
        orderEpisode('not-assistant', { verifiedTurns: [3] }, '5005'),
        orderEpisode('copy', {}, '1182'),
        assistantTwice,
        unanswered,
        unoffered,
        { id: 'scrap', messages: [] },
      ],
      remote,
    );
    expect(built.examples.map((example) => example.id)).toEqual(['base']);
    expect(built.manifest.excluded).toEqual([
      { episode_id: 'failed', reason: 'the checker did not pass it' },
      { episode_id: 'private', reason: 'its data may not leave this computer' },
      { episode_id: 'not-assistant', reason: 'verified turn 3 is not an assistant message' },
      { episode_id: 'copy', reason: 'the same conversation as base' },
      { episode_id: 'twice', reason: 'messages 4 and 5 are two assistant turns in a row' },
      { episode_id: 'unanswered', reason: 'the last tool calls were never answered' },
      { episode_id: 'unoffered', reason: 'message 2 calls write, which was not offered' },
      {
        episode_id: 'scrap',
        reason: expect.stringContaining('not a verified episode') as unknown as string,
      },
    ]);
  });

  it('keeps episodes that may not leave the computer when training stays on it', () => {
    const built = buildTrainingDataset(
      [orderEpisode('private', { sharing: { remoteTraining: false } })],
      { destination: 'local', now: NOW },
    );
    expect(built.examples).toHaveLength(1);
    expect(built.manifest.remote_training_allowed).toBe(false);
  });

  it('stops when an episode comes from outside the train split', () => {
    for (const split of ['test', 'dev', 'calibration'] as const) {
      const episode = orderEpisode('leaky', { origin: { kind: 'task', taskId: 't', split } });
      expect(() => buildTrainingDataset([episode], remote)).toThrow(GuardError);
    }
  });

  it('stops when an episode holds locked-test content', () => {
    const detector = {
      scan: (text: string) =>
        text.includes('1182')
          ? { leaked: true, matchedIds: ['ord-test-9'] }
          : { leaked: false, matchedIds: [] },
    };
    expect(() =>
      buildTrainingDataset([orderEpisode('ep-1')], { ...remote, leakDetector: detector }),
    ).toThrow(/holds locked-test content \(1 test tasks\)/);
    expect(
      buildTrainingDataset([orderEpisode('ep-2', {}, '2002')], {
        ...remote,
        leakDetector: detector,
      }).examples,
    ).toHaveLength(1);
  });

  it('takes accepted user corrections from the workspace', () => {
    const correction = orderEpisode('teach-1', {
      kind: 'user_correction',
      origin: { kind: 'workspace', chatId: 'cht_1', messageId: 'msg_7' },
    });
    const [example] = buildTrainingDataset([correction], remote).examples;
    expect(example?.provenance.origin).toBe('workspace chat cht_1, message msg_7');
    expect(example?.kind).toBe('user_correction');
  });

  it('refuses to build an empty dataset, listing every reason', () => {
    try {
      buildTrainingDataset(
        [orderEpisode('failed', { check: { pass: false, reason: 'No.' } })],
        remote,
      );
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(DatasetError);
      expect((error as DatasetError).excluded).toEqual([
        { episode_id: 'failed', reason: 'the checker did not pass it' },
      ]);
    }
  });
});
