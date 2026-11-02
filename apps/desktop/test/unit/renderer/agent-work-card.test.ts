import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { WorkspaceMessage } from '@architect/shared';
import { WorkCard } from '../../../src/renderer/src/agent/cards';

function reply(patch: Partial<WorkspaceMessage>): WorkspaceMessage {
  return {
    id: `msg_${patch.status ?? 'done'}`,
    chatId: 'cht_1',
    role: 'agent',
    createdAt: '2026-10-28T10:00:00.000Z',
    text: '',
    steps: [],
    blocks: [],
    status: 'done',
    ...patch,
  };
}

/** Each decision's label with its count, as the card lists them. */
function decisions(messages: WorkspaceMessage[]): Record<string, string> {
  const html = renderToStaticMarkup(createElement(WorkCard, { messages })).replace(/&#x27;/g, "'");
  const pairs = [...html.matchAll(/<dt>([^<]+)<\/dt><dd[^>]*>(\d+)<\/dd>/g)];
  return Object.fromEntries(pairs.map(([, label, value]) => [label, value]));
}

describe('the tools and decisions card', () => {
  it("counts a write that couldn't be saved apart from a reply that stopped on an error", () => {
    const failedWrite = reply({
      blocks: [
        {
          kind: 'approval',
          changeId: 'chg_1',
          op: 'append',
          file: 'data/x.csv',
          summary: 'Add 1 row to data/x.csv',
          status: 'failed',
        },
      ],
    });
    expect(decisions([failedWrite])).toMatchObject({
      "Writes that couldn't be saved": '1',
      'Stopped on an error': '0',
    });
    expect(decisions([{ ...failedWrite, status: 'error', error: 'It stopped.' }])).toMatchObject({
      "Writes that couldn't be saved": '1',
      'Stopped on an error': '1',
    });
  });
});
