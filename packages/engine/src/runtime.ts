/**
 * The engine runtime: the agent's files, the built-in tools, the tool sandbox, the student agent
 * loop, the checker, the splitter, the locked-test vault and evaluation.
 */

export { DataError } from './data/errors';
export type { RowSelection } from './data/query';
export type { FileInfo, Row, TableSnapshot } from './data/types';

export { openAgentFiles } from './files/agent-files';
export type {
  AgentFile,
  AgentFiles,
  AgentFilesOptions,
  CheckedFiles,
  FileArea,
  FilesMode,
  OutputFolder,
  PlannedChange,
} from './files/agent-files';

export type { ApproveWrite, PendingWrite, WriteDecision } from './tools/builtins';
export { BUILTIN_TOOL_SPECS, TOOL_RUNTIME } from './tools/specs';
export { createToolbox } from './tools/toolbox';
export type { Toolbox, ToolboxOptions, ToolOutcome } from './tools/toolbox';

export { createSandbox } from './sandbox/sandbox';
export type { SandboxOptions } from './sandbox/sandbox';
export type {
  CodeOutcome,
  CodeRequest,
  GrepOutcome,
  GrepRequest,
  Sandbox,
  SandboxData,
  SandboxFailure,
  SandboxOutcome,
  ValidatorContext,
} from './sandbox/types';

export { parseAnswerLine } from './agent/answer';
export type { ParsedAnswer } from './agent/answer';
export { continueAgent, runAgent } from './agent/loop';
export type { ContinueAgentOptions, RunAgentOptions } from './agent/loop';
export { buildSystemPrompt } from './agent/prompt';
export type { AgentMode, FolderSummary, SystemPromptInput } from './agent/prompt';
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
