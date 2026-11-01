import type { Labels } from '../lab/labels';
import type { Certificate } from '../lab/pages-lab2';

/**
 * What the launch film shows that the walkthrough doesn't. Every figure is a measured one, from the
 * same reports as the walkthrough's (site/film/lab/data.ts) and the runs named beside each. The
 * one beat that depends on a run is the PENDING flag at the end.
 */

/** The final test on Harborview Prep, which neither model saw (academy-desk-1.md): of 48 tasks. */
export const HARBORVIEW = { taught: 43, alone: 24, of: 48, name: 'Harborview Prep' } as const;

/** The final test at the real academy, never seen (academy-desk-1.md): of 24 tasks. */
export const REAL_ACADEMY = { taught: 12, alone: 9, of: 24 } as const;

/**
 * Inventory desk's final test at Corvid Hill Discovery, the screening lab neither model saw
 * (docs/comparisons/inventory-desk-1.md, branch runs/inventory-1): 27 of 32 against Glimmer
 * alone's 4. On the taught labs' test split it passed 21 of 24.
 */
export const CORVID = { taught: 27, alone: 4, of: 32, name: 'Corvid Hill Discovery' } as const;

/** Inventory desk's best final tests on the Fields page once its run is in: 21 of 24, 27 of 32. */
export const INVENTORY_SCORES = ['88%', '84%', '-'] as const;

/**
 * The harness changes of the academy field's first run (tutor-1, its lineage and harness folder):
 * round 1's files with their lines added and removed, v0001 to v0002; round 2's change to the
 * assign skill, v0002 to v0003, a few of its lines, with what Spark predicted and what was
 * measured before it was rolled back.
 */
export const HARNESS = {
  first: [
    { file: 'AGENTS.md', kind: 'prompt', added: 2, removed: 3 },
    { file: 'tools/question_lookup.js', kind: 'tool', added: 32, removed: 0 },
    { file: 'skills/diagnose/SKILL.md', kind: 'lesson', added: 7, removed: 10 },
  ],
  second: {
    file: 'skills/assign/SKILL.md',
    predicted: '+2 to +6',
    measured: '24 to 23 of 36',
    lines: [
      {
        kind: 'removed',
        line: 5,
        text: 'Read data/policy.md numbers first: want_n, band low/high, history N/T/D, hint rule.',
      },
      {
        kind: 'added',
        line: 5,
        text: 'Do NOT read policy.md for numbers. Tools read policy automatically.',
      },
      { kind: 'context', line: 6, text: 'Assign:' },
      {
        kind: 'removed',
        line: 7,
        text: '1. Resolve name to student_id. Call practice_pick with student_id, topic, low, high, want_n.',
      },
      { kind: 'added', line: 7, text: '1. grep students.csv for exact name -> student_id.' },
      {
        kind: 'added',
        line: 8,
        text: '2. Call practice_pick with ONLY student_id, topic. Use picks, next_ids, tutor_id.',
      },
    ],
  },
} as const;

/**
 * The counterexample is the repair demonstration of DECISIONS.md 078, on the academy example's
 * Copperfield data (engine counterexamples.test.ts), not a step of the first field run: the drawer
 * names its task as the app does.
 */
export const COUNTEREXAMPLE_TASK = 'copperfield-diagnose-03';

/** The first field run's check score before and after its first round (academy-desk-1.md): 17 and 25 of 36. */
export const FIRST_ROUND = [47, 69] as const;

/** Inventory desk's run finished on Nov 1 (inventory-desk-1.md). */
export const FIELD_ACTIVITY = { 'Inventory desk': 'Nov 1' } as const;

/**
 * The fine-tune's plan for a 235B mixture-of-experts model, read from its own config, and its
 * cluster bundle (docs/screenshots/compute-plan-dark.png; compute/Targets.tsx for the commands).
 */
export const PLAN = {
  model: 'lab/moe-235b',
  config: 'lab/moe-235b @ 00216c179c24 · qwen3_moe',
  figures: [
    ['235.1B', 'Parameters'],
    ['22.2B', 'Active per token'],
    ['94', 'Layers'],
    ['128', 'Experts, 8 per token'],
  ],
  fit: { gpus: 16, nodes: 2, each: '52.1 GB', usable: '72.0 GB' },
  sized: 'Sized for H100 80GB, 8 per node, bf16',
  commands: { slurm: 'sbatch submit.sbatch', kubernetes: 'kubectl apply -f pytorchjob.yaml' },
} as const;

/**
 * The first real fine-tune (docs/comparisons/qlora-1.md): Glimmer's open weights, QLoRA, on one
 * A100 80 GB, 8.2 minutes of GPU for $0.34. Its effect on the final test is not measured yet, so
 * the film shows only that it was trained, and where.
 */
export const TRAINED = {
  model: 'Glimmer',
  method: 'QLoRA',
  gpus: 1,
  gpu: 'A100',
  time: '8 min',
} as const;

/** The open-weight teacher, as the app names it (packages/shared/src/models.ts). */
export const OPEN_TEACHER = 'Muse Spark Open';

/**
 * The risk certificate issued on the first field run's Academy desk (academy-desk-cert-2.md): on 60
 * calibration tasks it answered all 60 with none wrong, a 95% bound of 4.87%, shown as 5%; the
 * check at Harborview Prep answered 53 of 54 with none wrong, so the bound held. The plot is the
 * report's risk and coverage by threshold.
 */
export const CERTIFICATE: Certificate = {
  wrong: 0.05,
  handed: 0,
  handedTo: 'a person',
  basis: 'It answers when 1 of 5 attempts agree, measured on 60 calibration tasks.',
  points: [
    { coverage: 59 / 60, bound: 0.0495, risk: 0 },
    { coverage: 59 / 60, bound: 0.0495, risk: 0 },
    { coverage: 1, bound: 0.0487, risk: 0 },
  ],
  chosen: 2,
  checks: [
    { name: 'Harborview Prep, never seen', detail: 'Answered 53 of 54, 0 wrong', held: true },
  ],
  example: false,
};

/** The certificate's check where the specialist never trained, as the film sets it large. */
export const CERTIFICATE_CHECK = {
  name: 'Harborview Prep',
  answered: '53 of 54',
  wrong: '0 wrong',
};

/** The app's newer words for the screens' concepts (the glossary the app is moving to). */
export const LAUNCH_LABELS: Labels = {
  arms: { bare: 'Glimmer alone', draft: 'One-shot harness', taught: 'Spark-engineered harness' },
  checks: 'held-out checks',
  certificate: 'Risk certificate',
  bestFinalTest: 'Best sealed final test',
};

/**
 * PENDING: the open-weight teacher's beat (script section 9's open line). False removes the beat
 * and the film closes the gap it leaves.
 */
export const SHOW_OPEN_TEACHER = true;
