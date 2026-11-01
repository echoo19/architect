/**
 * A field's assets for training elsewhere (docs/SCALE.md): the export of its verified
 * demonstrations, outcome scorer and sealed-evaluation manifest, and the scorer itself.
 */
export {
  buildFieldExport,
  exportField,
  exportFieldFromData,
  fieldSource,
  storedFieldSource,
  SFT_USES,
  type ExportFromDataOptions,
  type FieldSource,
  type SealedView,
} from './export';
export { attemptEpisodes, loadPassedAttempts, type PassedAttempt } from './attempts';
export { fieldDataset, FieldDatasetError } from './dataset';
export { openRewardScorer, type RewardScorer, type RewardScorerOptions } from './reward';
export { SCORE_CLIENT_PY } from './score-client';
export { fieldView } from './view';
