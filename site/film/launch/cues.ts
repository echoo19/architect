/**
 * The launch film's timing, written by architect-runs/film/launch/audio/final5/cues.mts from the
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
  { name: 'flight through the screens', at: 8.8, played: 7.92, section: 1, word: 'Architect' },
  { name: 'YC line', at: 10.85, played: 9.6, section: 2, word: 'Y Combinator' },
  { name: 'first request', at: 14.6, played: 12.98, section: 2, word: 'Own' },
  { name: 'second request', at: 19, played: 16.26, section: 2, word: 'AI' },
  { name: 'third request', at: 22.8, played: 20.34, section: 2, word: 'And (vertical)' },
  { name: 'on to the Lab', at: 27.6, played: 23.76, section: 2, word: '(after) check' },
  { name: 'Architect Lab beside its window', at: 29, played: 24.76, section: 3, word: 'This' },
  { name: 'the Lab, whole', at: 33.8, played: 29.64, section: 3, word: 'Spark' },
  { name: 'push onto the Lab', at: 34.6, played: 30.52, section: 3, word: "Meta's" },
  { name: 'the teaching run lit', at: 35.9, played: 31.96, section: 3, word: 'trains' },
  { name: 'Fields clicked', at: 40.6, played: 37.38, section: 4, word: 'Give' },
  { name: 'academy row lit', at: 42.7, played: 39.52, section: 4, word: 'academies' },
  { name: 'the field', at: 43.7, played: 40.26, section: 4, word: 'Glimmer' },
  { name: 'the vault: Harborview sealed', at: 47.7, played: 43.6, section: 4, word: 'vault' },
  {
    name: 'back to the real academy',
    at: 49.5,
    played: 45.68,
    section: 4,
    word: 'one (of them is real)',
  },
  { name: 'Define, the brief', at: 51.8, played: 47.61, section: 5, word: 'Spark' },
  { name: 'passages open', at: 56.2, played: 51.96, section: 5, word: 'every (rule)' },
  { name: 'Confirm pressed', at: 60, played: 54.28, section: 5, word: '(after) source' },
  { name: 'Train', at: 60.3, played: 54.7, section: 6, word: 'Then' },
  { name: 'the harness drawer', at: 62.4, played: 56.36, section: 6, word: 'harness' },
  { name: 'a prompt', at: 63.5, played: 57.22, section: 6, word: 'prompts' },
  { name: 'a tool', at: 64.65, played: 58.18, section: 6, word: 'tools' },
  { name: 'a lesson', at: 65.3, played: 59.06, section: 6, word: 'lessons' },
  {
    name: 'round 2, its change line by line',
    at: 66.3,
    played: 60.28,
    section: 6,
    word: 'Every (change)',
  },
  { name: 'measured where Spark never sees', at: 68.4, played: 62.44, section: 6, word: 'tested' },
  { name: 'rolled back', at: 72.5, played: 66.6, section: 6, word: 'rolled' },
  { name: '97%, 35 of 36', at: 75.4, played: 68, section: 6, word: 'Thirty-five' },
  { name: 'the counterexample', at: 77.5, played: 70.28, section: 7, word: 'When' },
  { name: 'the table shrinks', at: 79.5, played: 72.4, section: 7, word: 'hunts' },
  { name: '4 rows', at: 83.3, played: 75.84, section: 7, word: 'four' },
  { name: 'repaired', at: 85.1, played: 77.02, section: 7, word: 'Repaired' },
  { name: 'the case locked in', at: 86.8, played: 78.4, section: 7, word: 'regression' },
  { name: 'the vault again', at: 88.9, played: 80.18, section: 8, word: 'Then' },
  { name: 'the lock opens', at: 90, played: 81.44, section: 8, word: 'opens' },
  { name: 'Harborview Prep rises', at: 90.95, played: 82.3, section: 8, word: 'academy' },
  { name: '43 of 48', at: 94.3, played: 85.48, section: 8, word: 'Forty-three' },
  { name: 'Glimmer alone: 24', at: 95.6, played: 87.12, section: 8, word: 'Glimmer' },
  { name: 'back into the plot', at: 97.2, played: 88.84, section: 8, word: 'twenty-four' },
  { name: 'beside the window', at: 98, played: 89.34, section: 8, word: 'And' },
  { name: '12', at: 100.9, played: 91.04, section: 8, word: 'twelve' },
  { name: 'up from 9', at: 102.1, played: 92.32, section: 8, word: 'nine' },
  { name: 'Models', at: 104.1, played: 93.67, section: 9, word: 'Architect' },
  { name: 'the risk certificate', at: 105.7, played: 95.48, section: 9, word: 'specialists' },
  { name: 'wrong at most, beside the window', at: 108.1, played: 96.89, section: 9, word: 'wrong' },
  {
    name: 'Harborview Prep: 53 of 54, 0 wrong',
    at: 112.7,
    played: 101.98,
    section: 9,
    word: '(before) held',
  },
  { name: 'Compute', at: 114.9, played: 104.88, section: 9, word: 'when (the harness)' },
  { name: 'Read config', at: 116.4, played: 106.24, section: 9, word: 'enough' },
  { name: "the model's figures", at: 117.7, played: 108, section: 9, word: 'weights' },
  { name: 'LoRA chosen', at: 118.4, played: 108.88, section: 9, word: 'LoRA' },
  {
    name: 'the dive into the memory card',
    at: 119.3,
    played: 110.1,
    section: 9,
    word: '(before) sized',
  },
  { name: '235.1B parameters, LoRA', at: 119.8, played: 110.6, section: 9, word: 'sized' },
  { name: '16 GPUs, in 2 nodes', at: 120.8, played: 111.76, section: 9, word: 'config' },
  {
    name: 'Glimmer, QLoRA: 1 A100, trained in 8 min',
    at: 122,
    played: 112.88,
    section: 9,
    word: 'single',
  },
  { name: 'back to the plan', at: 123.4, played: 114.2, section: 9, word: 'packaged' },
  { name: 'Slurm', at: 124.4, played: 115.2, section: 9, word: 'Slurm' },
  { name: 'Kubernetes', at: 125.2, played: 115.84, section: 9, word: 'Kubernetes' },
  { name: 'the open teacher', at: 126.8, played: 116.76, section: 9, word: '(before) Even' },
  { name: 'Muse Spark Open', at: 129.4, played: 119.6, section: 9, word: 'Muse' },
  { name: 'Fields again', at: 131.8, played: 122.54, section: 10, word: '(before) And' },
  { name: 'academy row lit', at: 133.4, played: 123.96, section: 10, word: 'academies' },
  { name: 'the screening lab desks lit', at: 136, played: 126.8, section: 10, word: 'screening' },
  {
    name: 'the dive into Inventory desk',
    at: 139.4,
    played: 129.92,
    section: 10,
    word: '(before) never',
  },
  { name: 'Corvid Hill Discovery rises', at: 140, played: 130.59, section: 10, word: 'seen' },
  { name: '27 of 32', at: 141.1, played: 131.78, section: 10, word: 'twenty-seven' },
  { name: 'Glimmer alone: 4', at: 142.4, played: 133.48, section: 10, word: 'Glimmer' },
  { name: 'back to Fields', at: 143.7, played: 135.1, section: 10, word: 'four' },
  {
    name: 'the sidebar turns to the team',
    at: 144.6,
    played: 135.76,
    section: 10,
    word: 'specialists',
  },
  { name: 'the team chat', at: 146.2, played: 136.86, section: 10, word: 'team' },
  { name: 'Asking Assay desk', at: 147.8, played: 138.8, section: 10, word: 'asks' },
  { name: 'the compounds', at: 149, played: 140.32, section: 10, word: 'compounds' },
  { name: 'the hold', at: 151, played: 142.2, section: 10, word: 'reserves' },
  { name: 'the academy chat', at: 153.2, played: 144.2, section: 11, word: 'Then' },
  { name: 'Offline', at: 154.4, played: 145.28, section: 11, word: 'network' },
  { name: 'the answer', at: 155.4, played: 146.24, section: 11, word: 'specialist' },
  { name: 'Allow once, saved', at: 159.8, played: 150.64, section: 11, word: 'writes' },
  { name: 'the two editions', at: 161.2, played: 151.44, section: 12, word: '(before) Architect' },
  { name: 'Architect Lab chosen', at: 164.6, played: 154.84, section: 12, word: 'Lab' },
  {
    name: 'the window becomes the mark',
    at: 167,
    played: 157.1,
    section: 12,
    word: '(before) Your',
  },
  { name: 'Your own AI.', at: 168, played: 158, section: 12, word: 'Your' },
  { name: 'Architect', at: 170, played: 159.64, section: 12, word: 'Architect' },
  { name: 'end', at: 174.2, played: 162.27, section: 12, word: '(end of the take)' },
];

/** The film's length as played, in seconds: the take's. */
export const RUNTIME = 162.27;

/** [played, authored]: every beat. */
export const TIMING: readonly (readonly [number, number])[] = BEATS.map(
  (beat) => [beat.played, beat.at] as const,
);
