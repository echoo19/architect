import type { TraceStep } from '@architect/shared';
import { describe, expect, it } from 'vitest';
import { outOfStepsNote } from '../src/agent-host/respond';

function call(name: string): TraceStep {
  return { kind: 'tool', callId: `call_${name}`, name, arguments: {}, result: null, latencyMs: 1 };
}

describe('a reply that ran out of steps', () => {
  it('says what it tried, its most used tools first, and what to do next', () => {
    const steps = [
      call('read_file'),
      call('lookup_order'),
      call('read_file'),
      call('read_file'),
      call('list_files'),
      call('label_for'),
      call('label_for'),
    ];
    expect(outOfStepsNote(steps, 24)).toBe(
      'Stopped after 24 steps without an answer. It used read_file 3 times, label_for twice and lookup_order once. Ask again with more detail, or flag this reply to show it what you wanted.',
    );
  });

  it('says so when it never used a tool', () => {
    expect(outOfStepsNote([], 4)).toBe(
      'Stopped after 4 steps without an answer. It never used its tools. Ask again with more detail, or flag this reply to show it what you wanted.',
    );
    expect(outOfStepsNote([call('read_file')], 4)).toContain('It used read_file once.');
  });
});
