/**
 * The comparisons runner for decision 037's arms (decision 045): cost first, arms funded in
 * 037's order, every arm frozen before any locked result exists, and a report made from stored
 * records only. A developer tool: the app reads its JSON report, and never runs it.
 */
export { comparisonJob, DEFAULT_MODELS, type ComparisonModels } from './arms';
export { realEnvironment, type RealEnvironmentOptions } from './environment';
export { clearBeforeColdStart, COMPARISON_PURPOSE, comparisonLease } from './gpu';
export { renderMarkdown } from './markdown';
export { parseGpuMemory, parseProcessMemory, systemMeter, type SystemMeterOptions } from './meter';
export {
  ARM_ORDER,
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
export { counted, paired, wilson, Z95 } from './stats';
