/**
 * The engine: the runtime that runs a student inside its harness and checks the result, and the
 * core loop that trains, tests and graduates it. The desktop app starts `createEngineHost` in a
 * utility process with the real dependencies from `createEngineDeps`.
 */
export * from './runtime';
export * from './loop';
export * from './gguf';
export * from './local-runtime';
export * from './training';
export * from './hub';
export * from './training-plan';
export { createEngineDeps, type EngineWiringOptions } from './host/wiring';
export { realEnvironment, type RealEnvironmentOptions } from './comparisons/environment';
export { renderMarkdown as renderComparisonMarkdown } from './comparisons/markdown';
export {
  ExperimentService,
  type ExperimentEnvironment,
  type ExperimentServiceOptions,
} from './experiments/service';
// Both the runtime and the loop name these; the runtime's are the real types.
export type { LeakDetector, LeakScan, MentorReleased, TaskSplits } from './runtime';
