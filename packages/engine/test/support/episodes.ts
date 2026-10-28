import type { ToolSpec, VerifiedEpisode } from '@architect/shared';

export const READ_TOOL: ToolSpec = {
  name: 'read',
  description: 'Read a text file with line numbers.',
  parameters: {
    type: 'object',
    properties: { path: { type: 'string' } },
    required: ['path'],
  },
};

export const RUN_TOOL: ToolSpec = {
  name: 'run',
  description: 'Run JavaScript in the sandbox and return what it prints.',
  parameters: { type: 'object', properties: { code: { type: 'string' } }, required: ['code'] },
};

/**
 * A returns-desk episode: the student reads the orders table, then answers. The first assistant
 * turn is the student's own read; a replay correction verifies only the answer that follows it.
 */
export function orderEpisode(
  id: string,
  overrides: Partial<VerifiedEpisode> = {},
  order = '1182',
): VerifiedEpisode {
  return {
    id,
    lessonId: `lesson-${id}`,
    kind: 'replay_correction',
    category: 'orders',
    origin: { kind: 'task', taskId: `ord-train-${order}`, split: 'train' },
    messages: [
      { role: 'system', content: 'You are the returns desk at Larchwood Outfitters.' },
      { role: 'user', content: `Was order ${order} delivered before its promised date?` },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'call_1', name: 'read', arguments: { path: 'data/orders.csv' } }],
      },
      {
        role: 'tool',
        toolCallId: 'call_1',
        name: 'read',
        content: `order_id,promised,delivered\n${order},2026-11-20,2026-11-19`,
      },
      {
        role: 'assistant',
        content: `ANSWER: {"order_id": "${order}", "on_time": true}`,
        reasoning: 'Delivered on the 19th, promised the 20th.',
      },
    ],
    tools: [READ_TOOL, RUN_TOOL],
    verifiedTurns: [4],
    check: { pass: true, reason: 'The answer matches the order record.' },
    template: { reasoningStrength: 'low', currentDate: '2026-11-24' },
    provenance: {
      jobId: 'job_returns',
      runId: 'run_1',
      attemptId: `att_${id}`,
      harnessVersion: 3,
      studentModel: 'muse-glimmer:30b-iq2',
      mentorModel: 'muse-spark-1.3',
      replayFromStep: 2,
      verifiedAt: '2026-10-28T09:00:00.000Z',
    },
    sharing: { remoteTraining: true },
    ...overrides,
  };
}
