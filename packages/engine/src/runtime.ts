/**
 * The engine runtime: the job's data, the built-in tools, the tool sandbox, the student agent
 * loop, the checker, the splitter, the locked-test vault and evaluation.
 */

export { DataError } from './data/errors';
export type { RowSelection } from './data/query';
export { openTableStore } from './data/table-store';
export type {
  PlannedWrite,
  ReadOptions,
  ReadResult,
  StoreMode,
  TableChange,
  TableStore,
  TableStoreOptions,
} from './data/table-store';
export type { FileInfo, Row, TableSnapshot } from './data/types';

export type { ApproveWrite, PendingWrite, WriteDecision } from './tools/builtins';
export { BUILTIN_TOOL_SPECS } from './tools/specs';

export { createSandbox } from './sandbox/sandbox';
export type { SandboxOptions } from './sandbox/sandbox';
export type {
  Sandbox,
  SandboxData,
  SandboxFailure,
  SandboxOutcome,
  ValidatorContext,
} from './sandbox/types';

export { parseAnswerLine } from './agent/answer';
export type { ParsedAnswer } from './agent/answer';
export { runAgent } from './agent/loop';
export type { RunAgentOptions } from './agent/loop';
export { buildSystemPrompt } from './agent/prompt';
export type { AgentMode, SystemPromptInput } from './agent/prompt';
export { matchGuardrail, selectRetrieval } from './agent/retrieval';
export type { GuardrailMatch, Retrieved } from './agent/retrieval';
export { todayFor } from './agent/today';

export { CheckerError, createChecker } from './checker/checker';
export type { Checker, CheckerOptions } from './checker/checker';

export { SplitError, splitTasks } from './splits/split';
export type { TaskSplits } from './splits/split';

export type { LeakDetector, LeakScan } from './vault/fingerprint';
export { releaseMentor } from './vault/gate';
export type { MentorReleased } from './vault/gate';
export { Vault } from './vault/vault';

export { evaluateTasks, runTaskAttempt } from './eval/evaluate';
export type {
  AttemptOptions,
  EvalContext,
  EvaluateOptions,
  EvaluationItem,
  EvaluationResult,
  TaskAttemptResult,
} from './eval/evaluate';
export { taskSeed } from './eval/seed';
