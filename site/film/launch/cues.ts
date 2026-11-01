/**
 * The launch film's timing, written by architect-runs/film/launch/audio/final4/cues.mts from the
 * recorded take's word times (one take, placed on film time). The picture is authored on its own
 * clock (timeline.ts); each beat pairs an authored moment with when its word is said, and the
 * page moves smoothly between them (time.ts, `smoothMap`). Each scene starts as its narration
 * does, and each beat lands on its word.
 */

export interface Beat {
  name: string;
  /** Authored second. */
  at: number;
  /** When it is played: on its word. */
  played: number;
  /** The script's section (1 to 12), and the word it lands on. */
  section: number;
  word: string;
}

export const BEATS: readonly Beat[] = [
  { name: 'film start', at: 0, played: 0, section: 1, word: '' },
  { name: 'claim rises', at: 0.35, played: 0.35, section: 1, word: 'Every' },
  { name: 'first screen arrives', at: 1.6, played: 1.68, section: 1, word: 'knows' },
  { name: 'last screen arrives', at: 4.3, played: 4.2, section: 1, word: 'Your' },
  { name: 'flight through the screens', at: 8.8, played: 7.72, section: 1, word: 'Architect' },
  { name: 'YC line', at: 10.85, played: 9.52, section: 2, word: 'Y Combinator' },
  { name: 'first request', at: 14.6, played: 12.82, section: 2, word: 'Own' },
  { name: 'second request', at: 19, played: 15.98, section: 2, word: 'AI' },
  { name: 'third request', at: 22.8, played: 19.86, section: 2, word: 'And (vertical)' },
  { name: 'on to the Lab', at: 27.6, played: 23.16, section: 2, word: '(after) check' },
  { name: 'Architect Lab beside its window', at: 29, played: 24.28, section: 3, word: 'This' },
  { name: 'the Lab, whole', at: 33.8, played: 29.08, section: 3, word: 'Spark' },
  { name: 'push onto the Lab', at: 34.6, played: 29.72, section: 3, word: "Meta's" },
  { name: 'the teaching run lit', at: 35.9, played: 31.16, section: 3, word: 'trains' },
  { name: 'Fields clicked', at: 40.6, played: 36.58, section: 4, word: 'Give' },
  { name: 'academy row lit', at: 42.7, played: 38.64, section: 4, word: 'academies' },
  { name: 'the field', at: 43.7, played: 39.38, section: 4, word: 'Glimmer' },
  { name: 'the vault: Harborview sealed', at: 47.7, played: 42.88, section: 4, word: 'vault' },
  {
    name: 'back to the real academy',
    at: 49.5,
    played: 44.88,
    section: 4,
    word: 'one (of them is real)',
  },
  { name: 'Define, the brief', at: 51.8, played: 46.97, section: 5, word: 'Spark' },
  { name: 'passages open', at: 56.2, played: 51.24, section: 5, word: 'every (rule)' },
  { name: 'Confirm pressed', at: 60, played: 53.56, section: 5, word: '(after) source' },
  { name: 'Train', at: 60.3, played: 53.86, section: 6, word: 'Then' },
  { name: 'the harness drawer', at: 62.4, played: 55.6, section: 6, word: 'harness' },
  { name: 'a prompt', at: 63.5, played: 56.7, section: 6, word: 'prompts' },
  { name: 'a tool', at: 64.65, played: 57.86, section: 6, word: 'tools' },
  { name: 'a lesson', at: 65.3, played: 58.5, section: 6, word: 'lessons' },
  {
    name: 'round 2, its change line by line',
    at: 66.3,
    played: 59.56,
    section: 6,
    word: 'Every (change)',
  },
  { name: 'measured where Spark never sees', at: 68.4, played: 61.64, section: 6, word: 'tested' },
  { name: 'rolled back', at: 72.5, played: 65.72, section: 6, word: 'rolled' },
  { name: '97%, 35 of 36', at: 75.4, played: 67.2, section: 6, word: 'Thirty-five' },
  { name: 'the counterexample', at: 77.5, played: 69.35, section: 7, word: 'When' },
  { name: 'the table shrinks', at: 79.5, played: 71.4, section: 7, word: 'hunts' },
  { name: '4 rows', at: 83.3, played: 74.72, section: 7, word: 'four' },
  { name: 'repaired', at: 85.1, played: 75.9, section: 7, word: 'Repaired' },
  { name: 'the regression suite', at: 86.1, played: 76.55, section: 7, word: 'locked' },
  { name: 'the case locked in', at: 86.8, played: 77.12, section: 7, word: 'regression' },
  { name: 'the vault again', at: 88.9, played: 78.98, section: 8, word: 'Then' },
  { name: 'the lock opens', at: 90, played: 80.16, section: 8, word: 'opens' },
  { name: 'Harborview Prep rises', at: 90.95, played: 81.22, section: 8, word: 'academy' },
  { name: '43 of 48', at: 94.3, played: 84.13, section: 8, word: 'Forty-three' },
  { name: 'Glimmer alone: 24', at: 95.6, played: 85.68, section: 8, word: 'Glimmer' },
  { name: 'back into the plot', at: 97.2, played: 87.2, section: 8, word: 'twenty-four' },
  { name: 'beside the window', at: 98, played: 87.71, section: 8, word: 'And' },
  { name: '12', at: 100.9, played: 89.28, section: 8, word: 'twelve' },
  { name: 'up from 9', at: 102.1, played: 90.84, section: 8, word: 'nine' },
  { name: 'Models', at: 104.1, played: 91.83, section: 9, word: 'Architect' },
  { name: 'the risk certificate', at: 105.7, played: 93.64, section: 9, word: 'specialists' },
  { name: 'wrong at most, beside the window', at: 108.1, played: 95.05, section: 9, word: 'wrong' },
  {
    name: 'Harborview Prep: 53 of 54, 0 wrong',
    at: 112.7,
    played: 100.22,
    section: 9,
    word: '(before) held',
  },
  { name: 'Compute', at: 114.9, played: 103.2, section: 9, word: 'when (the harness)' },
  { name: 'Read config', at: 116.4, played: 104.6, section: 9, word: 'enough' },
  { name: "the model's figures", at: 117.7, played: 106.6, section: 9, word: 'weights' },
  { name: 'LoRA chosen', at: 118.4, played: 107.12, section: 9, word: 'LoRA' },
  {
    name: 'the dive into the memory card',
    at: 119.3,
    played: 108.34,
    section: 9,
    word: '(before) sized',
  },
  { name: '235.1B parameters, LoRA', at: 119.8, played: 108.84, section: 9, word: 'sized' },
  { name: '16 GPUs, in 2 nodes', at: 122.1, played: 111.3, section: 9, word: 'GPU' },
  { name: 'back to the plan', at: 123.2, played: 112.44, section: 9, word: 'across' },
  { name: 'Slurm', at: 124.2, played: 113.12, section: 9, word: 'Slurm' },
  { name: 'Kubernetes', at: 125, played: 113.76, section: 9, word: 'Kubernetes' },
  { name: 'the open teacher', at: 126.6, played: 114.6, section: 9, word: '(before) Even' },
  { name: 'Muse Spark Open', at: 129.2, played: 117.4, section: 9, word: 'Muse' },
  { name: 'Fields again', at: 131.6, played: 120.2, section: 10, word: '(before) And' },
  { name: 'academy row lit', at: 133.2, played: 121.64, section: 10, word: 'academies' },
  {
    name: 'the screening lab desks lit',
    at: 135.8,
    played: 124.48,
    section: 10,
    word: 'screening',
  },
  {
    name: 'the dive into Inventory desk',
    at: 139.2,
    played: 127.6,
    section: 10,
    word: '(before) never',
  },
  { name: 'Corvid Hill Discovery rises', at: 139.8, played: 128.19, section: 10, word: 'seen' },
  { name: '27 of 32', at: 140.9, played: 129.26, section: 10, word: 'twenty-seven' },
  { name: 'Glimmer alone: 4', at: 142.2, played: 131.04, section: 10, word: 'Glimmer' },
  { name: 'back to Fields', at: 143.5, played: 132.46, section: 10, word: 'four' },
  {
    name: 'the sidebar turns to the team',
    at: 144.4,
    played: 133.12,
    section: 10,
    word: 'specialists',
  },
  { name: 'the team chat', at: 146, played: 134.62, section: 10, word: 'team' },
  { name: 'Asking Assay desk', at: 147.6, played: 136.08, section: 10, word: 'asks' },
  { name: 'the compounds', at: 148.8, played: 137.52, section: 10, word: 'compounds' },
  { name: 'the hold', at: 150.8, played: 139.44, section: 10, word: 'reserves' },
  { name: 'the academy chat', at: 153, played: 141.48, section: 11, word: 'Then' },
  { name: 'Offline', at: 154.2, played: 142.88, section: 11, word: 'network' },
  { name: 'the answer', at: 155.2, played: 143.52, section: 11, word: 'specialist' },
  { name: 'Allow once, saved', at: 159.6, played: 147.84, section: 11, word: 'writes' },
  { name: 'the two editions', at: 161, played: 148.64, section: 12, word: '(before) Architect' },
  { name: 'Architect Lab chosen', at: 164.4, played: 151.96, section: 12, word: 'Lab' },
  {
    name: 'the window becomes the mark',
    at: 166.8,
    played: 154.14,
    section: 12,
    word: '(before) Your',
  },
  { name: 'Your own AI.', at: 167.8, played: 155.04, section: 12, word: 'Your' },
  { name: 'Architect', at: 169.8, played: 156.44, section: 12, word: 'Architect' },
  { name: 'end', at: 174, played: 159.04, section: 12, word: '(end of the take)' },
];

/** The film's length as played, in seconds: the take's. */
export const RUNTIME = 159.04;

/** [played, authored]: every beat. */
export const TIMING: readonly (readonly [number, number])[] = BEATS.map(
  (beat) => [beat.played, beat.at] as const,
);
