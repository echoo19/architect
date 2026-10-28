/**
 * The comparisons runner for decision 037's arms (decisions 045 and 051): cost first, arms funded
 * in 037's order, every request held to the student's credit and the GPU window, every arm frozen
 * before any locked result exists, and a report made from stored records only. A developer tool:
 * the app reads its JSON report, and never runs it.
 */
export { comparisonJob, DEFAULT_MODELS, type ComparisonModels } from './arms';
export { realEnvironment, type RealEnvironmentOptions } from './environment';
export { GPU_REFUSAL, GpuWindow } from './gpu';
export { guardedDeps, isGuardRefusal } from './guards';
export { inputsChanged, pinInputs } from './inputs';
export { renderMarkdown } from './markdown';
export { parseGpuMemory, parseProcessMemory, systemMeter, type SystemMeterOptions } from './meter';
export {
  ARM_ORDER,
  billingOf,
  DEFAULT_CONFIG,
  modelInputs,
  needsConfirmation,
  project,
  type ComparisonConfig,
} from './projection';
export { ComparisonFiles } from './records';
export { armRun, buildReport } from './report';
export {
  probeLocal,
  reportOnly,
  runComparison,
  type ComparisonEnvironment,
  type ComparisonOutcome,
  type ComparisonRequest,
} from './runner';
export { CREDIT_REFUSAL, StudentCredit, worstCaseUsd } from './spend';
export { counted, paired, wilson, Z95 } from './stats';
