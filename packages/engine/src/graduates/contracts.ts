import {
  contractTerms,
  JobContractSchema,
  sameContractTerms,
  type Job,
  type JobContract,
} from '@architect/shared';
import type { Clock } from '../loop/deps';
import { isoNow } from '../loop/time';
import type { EngineStore } from '../store/engine-store';

/**
 * Every version of each job's contract. Saving a job whose scope or success criteria changed
 * adds a version; the job's file stays editable, and old versions never change. A graduate
 * carries the version it was measured against, so a new version never inherits its result.
 */
export class ContractBook {
  constructor(
    private readonly store: EngineStore,
    private readonly clock: Clock,
  ) {}

  /**
   * The contract version that states what `job` states now: an existing one when its terms
   * match (the newest such), otherwise a new version after the latest.
   */
  ensure(job: Job): JobContract {
    return this.store.transaction(() => {
      const found = this.find(job);
      if (found) return found;
      const contract = JobContractSchema.parse({
        ...contractTerms(job),
        version: (this.store.contracts.latest(job.id)?.version ?? 0) + 1,
      });
      this.store.contracts.insert({
        jobId: job.id,
        version: contract.version,
        contract,
        createdAt: isoNow(this.clock),
      });
      return contract;
    });
  }

  /** The recorded version whose terms are what `job` states now, or null if none is. */
  find(job: Job): JobContract | null {
    const terms = contractTerms(job);
    return (
      this.store.contracts
        .list(job.id)
        .findLast(({ contract }) => sameContractTerms(contract, terms))?.contract ?? null
    );
  }
}
