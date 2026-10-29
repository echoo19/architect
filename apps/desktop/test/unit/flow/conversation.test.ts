import { describe, expect, it } from 'vitest';
import {
  conversationReducer,
  emptyConversation,
  lastMentorEntry,
  speakerOf,
  type Conversation,
  type ConversationAction,
} from '../../../src/renderer/src/flow/describe/conversation';
import { makeJob } from './factories';

function run(...actions: ConversationAction[]): Conversation {
  return actions.reduce(conversationReducer, emptyConversation);
}

const FILES = ['C:/office/invoices.csv', 'C:/office/policy.md'];

describe('conversationReducer', () => {
  it('shows the first message at once and waits for the mentor', () => {
    const state = run({ type: 'sent', text: 'Close out the day', files: FILES, at: 1 });
    expect(state.entries).toEqual([
      { kind: 'user', id: 'user-0', text: 'Close out the day', files: FILES },
    ]);
    expect(state.waiting).toEqual({ text: 'Close out the day', files: FILES, startedAt: 1 });
  });

  it('notes how many files the mentor read before its first reply only', () => {
    const state = run(
      { type: 'sent', text: 'Close out the day', files: FILES, at: 1 },
      { type: 'replied', turn: { sessionId: 's1', message: 'Which jobs?', options: [] } },
      { type: 'sent', text: 'Invoices and bookings', files: [], at: 2 },
      { type: 'replied', turn: { sessionId: 's1', message: 'Last one.', options: ['Yes', 'No'] } },
    );
    expect(state.sessionId).toBe('s1');
    expect(state.waiting).toBeNull();
    const mentor = state.entries.filter((entry) => entry.kind === 'mentor');
    expect(mentor.map((entry) => entry.readFiles)).toEqual([2, 0]);
    expect(lastMentorEntry(state)?.options).toEqual(['Yes', 'No']);
  });

  it('marks the option the user answered with', () => {
    const state = run(
      { type: 'sent', text: 'Close out the day', files: [], at: 1 },
      {
        type: 'replied',
        turn: { sessionId: 's1', message: 'Show line items?', options: ['Yes', 'No'] },
      },
      { type: 'sent', text: 'No', files: [], at: 2, option: 'No' },
    );
    const mentor = state.entries[1];
    expect(mentor?.kind === 'mentor' && mentor.chosen).toBe('No');
  });

  it('keeps a failed message so it can be sent again', () => {
    let state = run(
      { type: 'sent', text: 'Close out the day', files: FILES, at: 1 },
      { type: 'failed', error: new Error('The mentor did not answer.') },
    );
    expect(state.waiting).toBeNull();
    expect(state.failure?.error.message).toBe('The mentor did not answer.');
    expect(state.entries).toHaveLength(1);

    state = conversationReducer(state, { type: 'retried', at: 5 });
    expect(state.failure).toBeNull();
    expect(state.waiting).toEqual({ text: 'Close out the day', files: FILES, startedAt: 5 });
  });

  it('replaces an undelivered reply when the user writes another one', () => {
    const state = run(
      { type: 'sent', text: 'Close out the day', files: [], at: 1 },
      { type: 'replied', turn: { sessionId: 's1', message: 'Which jobs?', options: [] } },
      { type: 'sent', text: 'Invoces', files: [], at: 2 },
      { type: 'failed', error: new Error('Timed out.') },
      { type: 'sent', text: 'Invoices', files: [], at: 3 },
    );
    expect(state.entries.map((entry) => (entry.kind === 'user' ? entry.text : 'mentor'))).toEqual([
      'Close out the day',
      'mentor',
      'Invoices',
    ]);
  });

  it('holds the drafted job and remembers it once saved', () => {
    const draft = makeJob();
    const state = run(
      { type: 'sent', text: 'Close out the day', files: [], at: 1 },
      { type: 'replied', turn: { sessionId: 's1', message: '', options: [], draft } },
      { type: 'saved', entryId: 'mentor-1', jobId: draft.id },
    );
    expect(lastMentorEntry(state)?.draft).toEqual(draft);
    expect(lastMentorEntry(state)?.id).toBe('mentor-1');
    expect(state.saved).toEqual({ entryId: 'mentor-1', jobId: draft.id });
    expect(conversationReducer(state, { type: 'reset' })).toEqual(emptyConversation);
  });

  it('holds what the mentor said with a draft, and a conversation that ended with no draft', () => {
    const draft = makeJob();
    const note = "I couldn't settle this from your files and answers, so I left it open:\nA rule.";
    const drafted = run(
      { type: 'sent', text: 'Close out the day', files: FILES, at: 1 },
      { type: 'replied', turn: { sessionId: 's1', message: note, options: [], draft } },
    );
    expect(lastMentorEntry(drafted)).toMatchObject({ message: note, draft });
    expect(lastMentorEntry(drafted)?.ended).toBeUndefined();

    const ended = run(
      { type: 'sent', text: 'Close out the day', files: FILES, at: 1 },
      {
        type: 'replied',
        turn: { sessionId: 's2', message: 'Attach more rows.', options: [], ended: true },
      },
    );
    expect(lastMentorEntry(ended)).toMatchObject({ message: 'Attach more rows.', ended: true });
    expect(lastMentorEntry(ended)?.draft).toBeUndefined();
  });

  it('remembers when Architect is asking and not the mentor, and nothing otherwise', () => {
    const state = run(
      { type: 'sent', text: 'Close out the day', files: FILES, at: 1 },
      { type: 'replied', turn: { sessionId: 's1', message: 'Which jobs?', options: [] } },
      { type: 'sent', text: 'Invoices', files: [], at: 2 },
      {
        type: 'replied',
        turn: {
          sessionId: 's1',
          message: 'In invoices.csv, amount sometimes says "N/A". Does "N/A" mean no amount?',
          options: ['Count it as zero', 'Leave those rows out'],
          from: 'architect',
        },
      },
    );
    const [mentor, architect] = state.entries.filter((entry) => entry.kind === 'mentor');
    expect(mentor).not.toHaveProperty('from');
    expect(architect).toMatchObject({ from: 'architect' });
    expect(lastMentorEntry(state)?.options).toEqual(['Count it as zero', 'Leave those rows out']);
  });
});

describe('who is speaking', () => {
  const reply = (message: string, extra: object = {}): ConversationAction => ({
    type: 'replied',
    turn: { sessionId: 's1', message, options: ['A', 'B'], ...extra },
  });
  const said = (text: string): ConversationAction => ({ type: 'sent', text, files: [], at: 1 });
  const speakers = (state: Conversation): (string | undefined)[] =>
    state.entries.map((_, at) => speakerOf(state.entries, at, 'Spark'));

  it('is the mentor on its first reply and nobody after it, as it always was', () => {
    const state = run(said('Close out the day'), reply('One?'), said('A'), reply('Two?'));
    expect(speakers(state)).toEqual([undefined, 'Spark', undefined, undefined]);
  });

  it('is Architect when the conversation ended, where it has been the one to say so', () => {
    const state = run(said('Close out the day'), reply('Attach more.', { ended: true }));
    expect(speakers(state)).toEqual([undefined, 'Architect']);
  });

  it('is Architect on the first reply when it is the one asking, with nothing said for the mentor', () => {
    const state = run(
      said('Close out the day'),
      reply('What does N/A mean?', { from: 'architect' }),
    );
    expect(speakers(state)).toEqual([undefined, 'Architect']);
  });

  it('says Architect where it takes over from the mentor, once, and not again for its next question', () => {
    const state = run(
      said('Close out the day'),
      reply('One?'),
      said('A'),
      reply('What does N/A mean?', { from: 'architect' }),
      said('Count it as zero'),
      reply('And a dash?', { from: 'architect' }),
    );
    expect(speakers(state)).toEqual([
      undefined,
      'Spark',
      undefined,
      'Architect',
      undefined,
      undefined,
    ]);
  });

  it('says nothing for a message that ends the conversation after the mentor was asking', () => {
    const state = run(
      said('Close out the day'),
      reply('One?'),
      said('A'),
      reply('I still cannot settle this.', { ended: true }),
    );
    expect(speakers(state)).toEqual([undefined, 'Spark', undefined, undefined]);
  });

  it('names the mentor again when it carries on after Architect, but not an end Architect says', () => {
    const state = run(
      said('Close out the day'),
      reply('One?'),
      said('A'),
      reply('What does N/A mean?', { from: 'architect' }),
      said('Count it as zero'),
      reply('Two?'),
      said('B'),
      reply('And a dash?', { from: 'architect' }),
      said('Leave those rows out'),
      reply('Attach more.', { ended: true }),
    );
    expect(speakers(state)).toEqual([
      undefined,
      'Spark',
      undefined,
      'Architect',
      undefined,
      'Spark',
      undefined,
      'Architect',
      undefined,
      undefined,
    ]);
  });

  it('is nobody for something the person said', () => {
    expect(speakerOf(run(said('Hello')).entries, 0, 'Spark')).toBeUndefined();
  });
});
