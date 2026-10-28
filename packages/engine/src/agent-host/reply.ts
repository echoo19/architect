import type {
  AgentBlock,
  AgentStep,
  ReplyStep,
  TraceStep,
  WorkspaceMessage,
} from '@architect/shared';
import { settleMessage, type ReplyOutcome } from './messages';
import type { NewStep } from './steps';

/** A streaming reply goes out at most this often: about 30 updates a second. */
const PUBLISH_EVERY_MS = 33;
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
    const { text } = this.message;
    const piece = text === '' || this.turnEnded ? delta.trimStart() : delta;
    if (piece === '') return;
    const before = text !== '' && this.turnEnded ? `${text.trimEnd()}\n\n` : text;
    this.turnEnded = false;
    this.change({ text: before + piece }, false);
  }

  /** Keeps one step of the agent's work: the model's turn, a tool's result, a skill, a refusal. */
  recordStep(step: TraceStep): void {
    if (this.finished) return;
    this.work.push(replyStep(step));
  }

  /** The model finished a turn; text from its next turn starts a new paragraph. */
  endTurn(): void {
    this.turnEnded = true;
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

  decideApproval(changeId: string, status: 'approved' | 'denied'): void {
    this.change(
      {
        blocks: this.message.blocks.map((block): AgentBlock =>
          block.kind === 'approval' && block.changeId === changeId ? { ...block, status } : block,
        ),
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

  private change(patch: Partial<WorkspaceMessage>, structural: boolean): void {
    if (this.finished) return;
    this.message = { ...this.message, ...patch };
    this.unsavedStructure ||= structural;
    if (this.timer !== undefined) return;
    const wait = this.lastPublished + PUBLISH_EVERY_MS - performance.now();
    if (wait <= 0) this.flush();
    else this.timer = setTimeout(() => this.flush(), wait);
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
      return { kind: 'model', text: step.text, toolCalls: step.toolCalls };
    case 'tool':
      return {
        kind: 'tool',
        callId: step.callId,
        name: step.name,
        arguments: step.arguments,
        result: step.result,
        ...(step.error === undefined ? {} : { error: step.error }),
      };
    case 'skill':
      return { kind: 'skill', slug: step.slug, via: step.via };
    case 'refusal':
      return { kind: 'refusal', taskType: step.taskType, reason: step.reason };
  }
}
