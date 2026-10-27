export * from './deps';
export { BudgetGuard, type BudgetLeft, type BudgetUsage } from './budget';
export { RunController, type RunControllerOptions, type StartRunOptions } from './controller';
export { decideKeep, type KeepDecision, type KeepInput } from './keep';
export { JobLibrary } from './jobs';
export { DataPaths } from './paths';
export {
  devNoisePilot,
  type DevNoisePilotOptions,
  type DevNoiseReport,
  type DevNoiseTask,
  type PilotContext,
} from './pilot';
export { planNextStep, type PlanInput, type Step } from './plan';
export { deriveSeed, fanOutSeeds, sampleTrainBatch } from './seeds';

export { MentorGate, type LeakDetector, type LeakScan } from '../mentor/gate';
export {
  diagnoseRequest,
  oneShotRequest,
  renderMentorView,
  renderOneShotView,
  type PromptSettings,
} from '../mentor/prompts';
export { HYPOTHESIS_JSON_SCHEMA, MentorReplyError, parseHypothesis } from '../mentor/reply';
export { studentAsMentor } from '../mentor/student-author';
export { renderCompactTrace } from '../mentor/trace';
export {
  buildMentorView,
  buildOneShotView,
  type MentorViewInput,
  type OneShotView,
  type TrainResult,
} from '../mentor/view';

export { buildGraduateManifest } from '../report/manifest';
export { computeReportCard, percentile, type ReportCardInput } from '../report/report-card';

export { openEngineStore, type AttemptFilter, type EngineStore } from '../store/engine-store';
export type {
  GraduateFreeze,
  RunSeeds,
  StoredAttempt,
  StoredRound,
  StoredRun,
} from '../store/records';

export { connectEngine, type EngineClient } from '../host/client';
export { createEngineHost, type EngineHost, type EngineHostOptions } from '../host/engine-host';
export type { EnginePort } from '../host/port';
export type { EngineApi } from '../host/protocol';
