import type { GeneratedLab } from '@architect/example-assay-desk';

/**
 * What the Inventory desk takes from the Assay desk's lab of the same id: its name and working
 * day, every compound its plates hold, and the compounds the Assay desk sends for a re-test. The
 * lists are the Assay desk's own expected answers (its plate_report tasks), so a team of the two
 * agents passes a list from one to the other exactly as the Assay desk would give it.
 */

export interface RetestList {
  plate: string;
  /** The plate's inconclusive and borderline compounds not already queued, in plate order. */
  compounds: string[];
  /** How many of them the Assay desk queues: all, or its cap per plate when more qualify. */
  take: number;
}

export interface AssayLab {
  id: string;
  name: string;
  today: string;
  /** Every compound on the lab's plates, in plate and well order. */
  compounds: string[];
  /** One list for each plate that passed QC and has compounds to re-test. */
  lists: RetestList[];
}

interface PlatePlan {
  plate: string;
  qc: string;
  candidates: { compound: string }[];
  take: number;
}

export function assayLab(generated: GeneratedLab): AssayLab {
  const { organization, lab, tasks } = generated;
  const compounds = lab.plates.flatMap((plate) =>
    plate.wells.filter((w) => w.role === 'compound').map((w) => w.compound),
  );
  const lists = tasks
    .flatMap((task) =>
      task.type === 'plate_report' && task.expected.kind === 'end_state'
        ? [task.expected.params.retests as unknown as { plates: PlatePlan[] }]
        : [],
    )
    .map(({ plates: [plan] }) => {
      if (plan === undefined) throw new Error(`${organization.id} has a plate report of no plate`);
      return plan;
    })
    .filter((plan) => plan.qc === 'pass' && plan.candidates.length > 0)
    .sort((a, b) => (a.plate < b.plate ? -1 : 1))
    .map((plan) => ({
      plate: plan.plate,
      compounds: plan.candidates.map((c) => c.compound),
      take: plan.take,
    }));
  return {
    id: organization.id,
    name: organization.name,
    today: lab.style.today,
    compounds: [...new Set(compounds)],
    lists,
  };
}

/**
 * The list a team demo passes on: the longest one the Assay desk queues whole, so the compounds
 * it returns are exactly the ones it queues, whichever valid plan it picks.
 */
export function chainList(assay: AssayLab): RetestList {
  const whole = assay.lists.filter((list) => list.compounds.length === list.take);
  const longest = whole.reduce<RetestList | undefined>(
    (best, list) => (best && best.compounds.length >= list.compounds.length ? best : list),
    undefined,
  );
  if (!longest) throw new Error(`${assay.id} has no plate whose re-tests are queued whole`);
  return longest;
}
