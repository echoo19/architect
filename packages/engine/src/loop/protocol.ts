import type { StoredRun } from '../store/records';
import { isTerminal } from './plan';

/** Whether a run is frozen and parked until its locked test is released (decision 045). */
export function isHeld(record: StoredRun): boolean {
  return (
    record.freeze !== null &&
    record.protocol?.holdTest === true &&
    record.protocol.released !== true &&
    !isTerminal(record.run.status)
  );
}
