/**
 * A field's assets for training elsewhere (docs/SCALE.md): the export of its verified
 * demonstrations, outcome scorer and sealed-evaluation manifest, and the scorer itself.
 */
export {
  exportField,
  exportFieldFromData,
  SFT_USES,
  type ExportFromDataOptions,
  type FieldSource,
  type SealedView,
} from './export';
export { openRewardScorer, type RewardScorer, type RewardScorerOptions } from './reward';
export { SCORE_CLIENT_PY } from './score-client';
