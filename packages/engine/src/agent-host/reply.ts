import type {
  AgentBlock,
  AgentStep,
  ReplyStep,
  TraceStep,
  WorkspaceMessage,
} from '@architect/shared';
import { settleMessage, type ReplyOutcome } from './messages';
import type { NewStep } from './steps';

type ApprovalStatus = Extract<AgentBlock, { kind: 'approval' }>['status'];

/** A streaming reply goes out at most this often: about 30 updates a second. */
const PUBLISH_EVERY_MS = 33;
/** The one step that says a reply waits for the GPU. */
const WAIT_STEP = 'step-gpu';
/** New text alone is saved at most this often. Steps, blocks and the end are saved at once. */
const SAVE_TEXT_EVERY_MS = 1_000;

/** Sends the reply to listeners and, when `save` is true, to the store as well. */
export type PublishReply = (message: WorkspaceMessage, save: boolean) => void;

/**
 * The agent's message while it is being written. Every change lands here and goes out
 * throttled: the first change at once, later ones together at most every 33 ms. Text from
 * separate model turns is kept, with a blank line between turns.
 */
export class LiveReply {
  private message: WorkspaceMessage;
  /** The reply's work as the model took it, saved with the reply when it settles. */
  private readonly work: ReplyStep[] = [];
  private readonly started = performance.now();
  /** The step each running tool call shows as, by call id. */
  private readonly calls = new Map<string, string>();
  private stepCount = 0;
  private turnEnded = false;
  /** How the text stood before the turn being written began, to go back to if it starts over. */
  private turnStart: { text: string; turnEnded: boolean } | null = null;
  private finished = false;
  private unsavedStructure = false;
  private lastPublished = Number.NEGATIVE_INFINITY;
  private lastSaved: number;
  private timer: ReturnType<typeof setTimeout> | undefined;

  /** `message` has already been saved and published as it is. */
  constructor(
    message: WorkspaceMessage,
    private readonly publish: PublishReply,
  ) {
    this.message = message;
    this.lastSaved = this.started;
  }

  appendText(delta: string): void {
    this.turnStart ??= { text: this.message.text, turnEnded: this.turnEnded };
    const { text } = this.message;
    const piece = text === '' || this.turnEnded ? delta.trimStart() : delta;
    if (piece === '') return;
    const before = text !== '' && this.turnEnded ? `${text.trimEnd()}\n\n` : text;
    this.turnEnded = false;
    this.change({ text: before + piece }, false);
  }

  /**
   * The turn being written is asked for again, so the text it showed goes: the reply reads as if
   * that turn had not been written yet, and the text of its next try follows. Published at once,
   * so a listener that can't take text back (the command line) hears of it before the new text.
   */
  retract(): void {
    const start = this.turnStart;
    this.turnStart = null;
    if (start === null) return;
    this.turnEnded = start.turnEnded;
    this.change({ text: start.text }, true, true);
  }

  /** Keeps one step of the agent's work: the model's turn, a tool's result, a skill, a refusal. */
  recordStep(step: TraceStep): void {
    if (this.finished) return;
    this.work.push(replyStep(step));
  }

  /** The model finished a turn; text from its next turn starts a new paragraph. */
  endTurn(): void {
    this.turnEnded = true;
    this.turnStart = null;
  }

  addStep(step: NewStep, callId?: string): void {
    const id = `step-${++this.stepCount}`;
    if (callId !== undefined) this.calls.set(callId, id);
    this.change({ steps: [...this.message.steps, { ...step, id }] }, true);
  }

  /** Replaces the step of a tool call that has returned. False when no step shows that call. */
  finishCall(callId: string, finish: (step: NewStep) => NewStep): boolean {
    const id = this.calls.get(callId);
    if (id === undefined) return false;
    this.calls.delete(callId);
    this.change(
      {
        steps: this.message.steps.map((step): AgentStep =>
          step.id === id ? { ...finish(step), id } : step,
        ),
      },
      true,
    );
    return true;
  }

  addBlock(block: AgentBlock): void {
    this.change({ blocks: [...this.message.blocks, block] }, true);
  }

  /**
   * Shows that the reply waits its turn for the GPU, and for whom, as one quiet step after its
   * others: "Waiting for the GPU: Architect is checking an agent on this computer".
   */
  waitForGpu(who: string): void {
    const step: AgentStep = {
      id: WAIT_STEP,
      kind: 'wait',
      name: 'gpu',
      detail: `Waiting for the GPU: ${who}`,
      status: 'running',
    };
    this.change({ steps: [...this.withoutWait(), step] }, true);
  }

  /** Takes the waiting step away: the reply has the GPU, or stopped waiting for it. */
  endWait(): void {
    if (this.message.steps.some((step) => step.id === WAIT_STEP)) {
      this.change({ steps: this.withoutWait() }, true);
    }
  }

  private withoutWait(): AgentStep[] {
    return this.message.steps.filter((step) => step.id !== WAIT_STEP);
  }

  /** Sets an approval's status, with why its save failed when it did; the error goes otherwise. */
  updateApproval(changeId: string, status: ApprovalStatus, error?: string): void {
    this.change(
      {
        blocks: this.message.blocks.map((block): AgentBlock => {
          if (block.kind !== 'approval' || block.changeId !== changeId) return block;
          const { error: _previous, ...rest } = block;
          return { ...rest, status, ...(error === undefined ? {} : { error }) };
        }),
      },
      true,
    );
  }

  /** Settles the reply and saves and publishes it at once. Later changes are ignored. */
  finish(outcome: ReplyOutcome): WorkspaceMessage {
    if (this.finished) return this.message;
    this.finished = true;
    clearTimeout(this.timer);
    this.message = {
      ...settleMessage(this.message, outcome),
      trace: [...this.work],
      workedMs: Math.round(performance.now() - this.started),
    };
    this.publish(this.message, true);
    return this.message;
  }

  /** `now` skips the wait between updates, for a change a listener must not see merged with the next. */
  private change(patch: Partial<WorkspaceMessage>, structural: boolean, now = false): void {
    if (this.finished) return;
    this.message = { ...this.message, ...patch };
    this.unsavedStructure ||= structural;
    if (this.timer !== undefined && !now) return;
    const wait = now ? 0 : this.lastPublished + PUBLISH_EVERY_MS - performance.now();
    if (wait <= 0) {
      clearTimeout(this.timer);
      this.flush();
    } else {
      this.timer = setTimeout(() => this.flush(), wait);
    }
  }

  private flush(): void {
    this.timer = undefined;
    const now = performance.now();
    const save = this.unsavedStructure || now - this.lastSaved >= SAVE_TEXT_EVERY_MS;
    if (save) {
      this.lastSaved = now;
      this.unsavedStructure = false;
    }
    this.lastPublished = now;
    this.publish(this.message, save);
  }
}

/** A trace step as a reply keeps it: what was said, called and returned, without timings. */
function replyStep(step: TraceStep): ReplyStep {
  switch (step.kind) {
    case 'model':
      return {
        kind: 'model',
        text: step.text,
        calls: step.toolCalls.map((call) => ({
          id: call.id,
          name: call.name,
          arguments: JSON.stringify(call.arguments),
        })),
      };
    case 'tool':
      return {
        kind: 'tool',
        callId: step.callId,
        name: step.name,
        arguments: JSON.stringify(step.arguments),
        result: typeof step.result === 'string' ? step.result : JSON.stringify(step.result ?? null),
        ...(step.error === undefined ? {} : { error: step.error }),
      };
    case 'skill':
      return { kind: 'skill', slug: step.slug, via: step.via };
    case 'refusal':
      return { kind: 'refusal', taskType: step.taskType, reason: step.reason };
  }
}
