import { REPAIR_RUN } from '../results';
import { Actors } from './Actors';

/**
 * What the repair shop's run showed, under the picture of its rule: the rule the person confirmed
 * is what the final test grades ticket costs by, so this says how that run went and no more. The
 * words are in `src/results.ts`.
 */
export function RepairRun() {
  return (
    <p className="mb-0 mt-6 max-w-[62ch] text-[17px] leading-relaxed text-fg text-pretty sm:mt-8">
      <Actors text={REPAIR_RUN} />
    </p>
  );
}
