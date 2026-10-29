import type {
  ChatMessage,
  ClearedResult,
  JsonValue,
  ToolCall,
  ToolSpec,
  Usage,
} from '@architect/shared';

/*
 * The model's context is small (16,384 tokens on this computer), and a prompt that fills it makes
 * the runtime cut the reply off in the middle, which Ollama then reports as a tool call it could
 * not read. This keeps every prompt inside the context, with room left for the reply: before each
 * turn it sizes the prompt, and when the prompt is too big it replaces the oldest tool results,
 * in what the model is sent, with a note that says what they were. The trace keeps every result.
 *
 * How a prompt is sized. A turn's usage gives the exact size of its prompt and reply, so the next
 * prompt is that plus whatever was added since, counted by characters. Characters are counted
 * for tokens the way Glimmer's tokenizer spends them: a digit costs about a token, so a table of
 * dates and ids runs near 1.7 characters a token, while prose runs near 3.8. A single ratio would
 * be either too low for a table or twice too high for prose. The constants were fitted to 143
 * samples from the returns desk and home services jobs (the files as the read tool prints them,
 * search and code output, calls, and some text that isn't English), counted with Glimmer's own
 * vocabulary in llama.cpp's llama-tokenize. With the margin no sample is counted under its true
 * size; of the 127 over 100 characters, the typical one comes out a third high and the highest
 * two thirds. `test/token-estimate.test.ts` keeps a spread of them with their real counts.
 */

/** A digit costs about a token. */
const DIGIT_TOKENS = 1;
/** Any other ASCII character, in prose, JSON or code: about a third of a token. */
const CHARACTER_TOKENS = 1 / 3;
/** A character outside ASCII (other scripts, accents, emoji): one token, which counts high. */
const WIDE_TOKENS = 1;
/** Counted on top, so a sample the fit missed still isn't under its true size. */
const MARGIN = 1.1;
/** What the chat template adds around a message: the largest of its wrappers, for a tool result. */
const MESSAGE_OVERHEAD_TOKENS = 16;
/** What it adds around each tool call an assistant message makes. */
const CALL_OVERHEAD_TOKENS = 40;
/** The instructions the template puts before the tool list, measured at 302 tokens. */
const TOOLS_OVERHEAD_TOKENS = 320;
/** A reported size below this share of the estimate isn't believed; it is counted by characters. */
const BELIEVED_SHARE = 1 / 2.5;

/** The tokens a piece of text takes, counted high. */
export function estimateTokens(text: string): number {
  let digits = 0;
  let wide = 0;
  for (let at = 0; at < text.length; at += 1) {
    const code = text.charCodeAt(at);
    if (code >= 48 && code <= 57) digits += 1;
    else if (code > 127) wide += 1;
  }
  const other = text.length - digits - wide;
  return Math.ceil(
    (digits * DIGIT_TOKENS + other * CHARACTER_TOKENS + wide * WIDE_TOKENS) * MARGIN,
  );
}

/** What the model reads of a message, counted: its text, and each call it makes. */
function messageTokens(message: ChatMessage): number {
  if (message.role !== 'assistant' || message.toolCalls === undefined) {
    return MESSAGE_OVERHEAD_TOKENS + estimateTokens(message.content);
  }
  const calls = message.toolCalls.map(
    (call) =>
      CALL_OVERHEAD_TOKENS +
      estimateTokens(call.name) +
      estimateTokens(JSON.stringify(call.arguments)),
  );
  return (
    MESSAGE_OVERHEAD_TOKENS + estimateTokens(message.content) + calls.reduce((a, b) => a + b, 0)
  );
}

/** How a context divides between the prompt and the reply it must leave room for. */
export interface ContextBudget {
  contextLength: number;
  /** Tokens kept for the reply: what the harness lets a turn write, but at most a quarter of the context. */
  replyRoom: number;
  /** Tokens a prompt may take: the context less the reply's room. */
  promptRoom: number;
}

/**
 * The budget for a context of `contextLength` tokens when a turn may write `maxOutputTokens`.
 * After a reply was cut off, the room for the next try grows to the whole output limit, but never
 * past half the context, so what the reply needed isn't taken from the prompt twice.
 */
export function contextBudget(
  contextLength: number,
  maxOutputTokens: number,
  afterCutOff = false,
): ContextBudget {
  const share = afterCutOff ? 2 : 4;
  const replyRoom = Math.min(maxOutputTokens, Math.floor(contextLength / share));
  return { contextLength, replyRoom, promptRoom: contextLength - replyRoom };
}

/** The conversation as the model reads it after the oldest results were cleared, and whether it fits. */
export interface Fit {
  messages: ChatMessage[];
  /** The results this fit cleared, oldest first. */
  cleared: ClearedResult[];
  /** The prompt's size in tokens, estimated. */
  tokens: number;
  budget: ContextBudget;
  fits: boolean;
}

/** What a model call told about the size of the conversation it was given. */
interface Anchor {
  /** The first `count` messages of the conversation were sized: the prompt, and the reply if any. */
  count: number;
  /** Their reported size in tokens, with the tool list and the template around them. */
  tokens: number;
  /** What the estimate made of the same messages, so a later change to them can be scaled. */
  estimated: number;
}

/**
 * One agent run's hold on the model's context. It keeps which tool results were cleared (they stay
 * cleared, so the model sees one conversation from turn to turn) and what the last call reported.
 */
export class ContextWindow {
  private readonly stubs = new Map<number, string>();
  private anchor: Anchor | null = null;
  private readonly toolsTokens: number;

  constructor(
    private readonly contextLength: number,
    private readonly maxOutputTokens: number,
    tools: readonly ToolSpec[],
  ) {
    this.toolsTokens = TOOLS_OVERHEAD_TOKENS + estimateTokens(JSON.stringify(tools));
  }

  /**
   * The conversation to send for model turn `turn`. While the estimate is over the prompt's room,
   * the oldest tool results not yet cleared are replaced by a stub, one at a time. The newest
   * results (those after the model's last turn, which it has yet to read), its own messages, the
   * system prompt and the person's messages are never touched. When nothing is left to clear and
   * the prompt still doesn't fit, `fits` is false.
   */
  fit(messages: readonly ChatMessage[], turn: number, afterCutOff = false): Fit {
    const budget = contextBudget(this.contextLength, this.maxOutputTokens, afterCutOff);
    const cleared: ClearedResult[] = [];
    let tokens = this.tokensOf(this.view(messages));
    if (tokens > budget.promptRoom) {
      const calls = callsOf(messages);
      const newest = messages.findLastIndex((message) => message.role === 'assistant') + 1;
      for (let at = 0; at < newest && tokens > budget.promptRoom; at += 1) {
        const message = messages[at];
        if (message?.role !== 'tool' || this.stubs.has(at)) continue;
        const stub = stubFor(calls.get(message.toolCallId), message.name, message.content);
        if (stub.length >= message.content.length) continue;
        this.stubs.set(at, stub);
        cleared.push({ turn, callId: message.toolCallId, name: message.name, stub });
        tokens = this.tokensOf(this.view(messages));
      }
    }
    return {
      messages: this.view(messages),
      cleared,
      tokens,
      budget,
      fits: tokens <= budget.promptRoom,
    };
  }

  /**
   * Takes in what a model call reported. `messages` is the conversation after the call: with the
   * reply when there was one to keep, or just the prompt when the reply was cut off and thrown
   * away, which still shows how big the prompt really was.
   */
  learn(messages: readonly ChatMessage[], usage: Usage, replied: boolean): void {
    const reported = usage.inputTokens + (replied ? usage.outputTokens : 0);
    const estimated = this.toolsTokens + sumTokens(this.view(messages));
    this.anchor =
      reported > 0 && reported >= estimated * BELIEVED_SHARE
        ? { count: messages.length, tokens: reported, estimated }
        : null;
  }

  /** The messages as the model reads them: cleared results replaced by their stubs. */
  private view(messages: readonly ChatMessage[]): ChatMessage[] {
    return messages.map((message, at) => {
      const stub = this.stubs.get(at);
      return stub === undefined || message.role !== 'tool'
        ? message
        : { ...message, content: stub };
    });
  }

  /**
   * The size of a conversation: what the last call reported for the messages it covered, scaled
   * down by what clearing took out of them since, plus the messages after them counted by
   * characters. With no call yet, everything is counted by characters.
   */
  private tokensOf(view: readonly ChatMessage[]): number {
    const anchor = this.anchor;
    if (anchor === null) return this.toolsTokens + sumTokens(view);
    const covered = this.toolsTokens + sumTokens(view.slice(0, anchor.count));
    const known = anchor.tokens * Math.min(1, covered / anchor.estimated);
    return Math.ceil(known + sumTokens(view.slice(anchor.count)));
  }
}

function sumTokens(messages: readonly ChatMessage[]): number {
  return messages.reduce((total, message) => total + messageTokens(message), 0);
}

/** Every tool call the assistant made, by its id. */
function callsOf(messages: readonly ChatMessage[]): Map<string, ToolCall> {
  const calls = new Map<string, ToolCall>();
  for (const message of messages) {
    if (message.role !== 'assistant') continue;
    for (const call of message.toolCalls ?? []) calls.set(call.id, call);
  }
  return calls;
}

/** The note a cleared result is replaced by: what the call was, and how to get the result back. */
function stubFor(call: ToolCall | undefined, name: string, content: string): string {
  const { what, again } = describe(call, name, content);
  return `[Cleared to make room: ${what}. ${again} if you need it.]`;
}

/** What a call was, in words the model can act on, and the way to ask for it again. */
function describe(
  call: ToolCall | undefined,
  name: string,
  content: string,
): { what: string; again: string } {
  const args = call?.arguments ?? {};
  const path = text(args['path']);
  switch (name) {
    case 'read': {
      const lines = linesShown(content);
      return {
        what: `${phrase('read', path)}${lines === '' ? '' : `, ${lines}`}`,
        again: 'Read it again',
      };
    }
    case 'ls':
      return { what: phrase('ls', path), again: 'List it again' };
    case 'glob':
      return { what: phrase('glob', text(args['pattern'])), again: 'List it again' };
    case 'grep': {
      const pattern = text(args['pattern']);
      return {
        what: phrase('grep', pattern === '' ? '' : JSON.stringify(pattern), path && `in ${path}`),
        again: 'Search again',
      };
    }
    case 'run': {
      const first = text(args['code']).split('\n', 1)[0] ?? '';
      return {
        what: phrase('run', first === '' ? '' : JSON.stringify(clip(first, 60))),
        again: 'Run it again',
      };
    }
    default: {
      const shown = call === undefined ? '' : JSON.stringify(call.arguments);
      return { what: phrase(name, shown === '{}' ? '' : clip(shown, 80)), again: 'Call it again' };
    }
  }
}

/** The lines a read showed, such as "lines 1-119", from the numbers that start them. */
function linesShown(content: string): string {
  let first = 0;
  let last = 0;
  for (const line of content.split('\n')) {
    const number = /^ *(\d+)\t/.exec(line)?.[1];
    if (number === undefined) continue;
    if (first === 0) first = Number(number);
    last = Number(number);
  }
  if (first === 0) return '';
  return first === last ? `line ${first}` : `lines ${first}-${last}`;
}

/** Words joined with spaces, leaving out the empty ones. */
function phrase(...words: string[]): string {
  return words.filter((word) => word !== '').join(' ');
}

function text(value: JsonValue | undefined): string {
  return typeof value === 'string' ? value : '';
}

function clip(value: string, limit: number): string {
  return value.length > limit ? `${value.slice(0, limit)}...` : value;
}

/** Why an attempt ends when what can't be cleared doesn't fit: said plainly, with the figures. */
export function noRoomError(fit: Fit): string {
  const { budget } = fit;
  const number = (value: number) => value.toLocaleString('en-US');
  return (
    "This task needs more room than the model's context allows. " +
    `The request, the agent's instructions and the latest result come to about ${number(fit.tokens)} tokens, ` +
    `and a context of ${number(budget.contextLength)} tokens leaves ${number(budget.promptRoom)} for them once the reply has its room. ` +
    "Use a model with a larger context, or shorten the agent's instructions."
  );
}
