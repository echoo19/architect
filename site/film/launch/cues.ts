/**
 * The launch film's timing, written by architect-runs/film/launch/audio/final9/cues.mts from the
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
  /** The script's section (1 to 12; 0 is the founder's clip), and the word it lands on. */
  section: number;
  word: string;
}

export const BEATS: readonly Beat[] = [
  {
    name: "the founder's frame",
    at: -1.3,
    played: -1.3,
    section: 0,
    word: "(the founder) Here's how it works.",
  },
  { name: 'film start', at: 0, played: 0, section: 1, word: '' },
  {
    name: 'the training screen pushes into his window',
    at: 0.6,
    played: 0.6,
    section: 1,
    word: 'Every',
  },
  { name: 'the training screen, Spark at work', at: 1.6, played: 1.56, section: 1, word: 'knows' },
  { name: 'onto the score', at: 4.3, played: 3.7, section: 1, word: 'Your' },
  { name: 'the score holds', at: 8.8, played: 7.1, section: 1, word: 'Architect' },
  { name: 'YC line', at: 10.85, played: 8.91, section: 2, word: 'Y Combinator' },
  { name: 'first request', at: 15.7, played: 11.78, section: 2, word: 'Own' },
  { name: 'second request', at: 18.35, played: 13.33, section: 2, word: 'AI' },
  { name: 'third request', at: 22.2, played: 15.6, section: 2, word: 'And (vertical)' },
  { name: 'on to the Lab', at: 27.6, played: 18.79, section: 2, word: '(after) check' },
  { name: 'Architect Lab beside its window', at: 29, played: 19.81, section: 3, word: 'This' },
  { name: 'the Lab, whole', at: 33.8, played: 24.3, section: 3, word: 'Spark' },
  { name: 'push onto the Lab', at: 34.6, played: 24.86, section: 3, word: "Meta's" },
  { name: 'the teaching run lit', at: 35.9, played: 26.2, section: 3, word: 'trains' },
  { name: 'the line: Give it a field.', at: 40.6, played: 31.27, section: 4, word: 'Give' },
  { name: 'the field whips in', at: 42.2, played: 32.89, section: 4, word: 'academies' },
  { name: 'the field', at: 43.7, played: 34.35, section: 4, word: 'Glimmer' },
  { name: 'the vault: Harborview sealed', at: 47.7, played: 37.51, section: 4, word: 'vault' },
  {
    name: 'back to the real academy',
    at: 49.5,
    played: 39.48,
    section: 4,
    word: 'one (of them is real)',
  },
  { name: 'Define, the brief', at: 51.8, played: 41.48, section: 5, word: 'Spark' },
  { name: 'passages open', at: 56.2, played: 45.47, section: 5, word: 'every (rule)' },
  { name: 'Confirm pressed', at: 60, played: 48.03, section: 5, word: '(after) source' },
  { name: 'Train', at: 60.15, played: 48.15, section: 6, word: 'Then' },
  { name: 'the harness drawer', at: 62.4, played: 49.86, section: 6, word: 'harness' },
  { name: 'a prompt', at: 63.5, played: 50.74, section: 6, word: 'prompts' },
  { name: 'a tool', at: 64.65, played: 51.57, section: 6, word: 'tools' },
  { name: 'a lesson', at: 65.3, played: 52.31, section: 6, word: 'lessons' },
  {
    name: 'round 2, its change line by line',
    at: 66.3,
    played: 53.54,
    section: 6,
    word: 'Every (change)',
  },
  { name: 'measured where Spark never sees', at: 68.4, played: 55.58, section: 6, word: 'tested' },
  { name: 'rolled back', at: 72.5, played: 59.71, section: 6, word: 'rolled' },
  { name: '97%, 35 of 36', at: 75.1, played: 61.01, section: 6, word: 'Thirty-five' },
  { name: 'the counterexample', at: 77.2, played: 63.28, section: 7, word: 'When' },
  { name: 'the table shrinks', at: 79.2, played: 65.3, section: 7, word: 'hunts' },
  { name: '4 rows', at: 83, played: 68.63, section: 7, word: 'four' },
  { name: 'repaired', at: 84.8, played: 70.04, section: 7, word: 'Repaired' },
  { name: 'the case locked in', at: 86.5, played: 71.21, section: 7, word: 'regression' },
  {
    name: 'the vault again, on the drop',
    at: 88.6,
    played: 73.53,
    section: 8,
    word: '(the drop before) Then',
  },
  { name: 'the lock opens', at: 89.7, played: 74.11, section: 8, word: 'opens' },
  { name: 'Harborview Prep rises', at: 90.65, played: 75.15, section: 8, word: 'academy' },
  { name: '43 rises', at: 93.6, played: 77.59, section: 8, word: '(just before) Forty-three' },
  { name: '43 of 48 lands', at: 94, played: 77.92, section: 8, word: 'Forty-three' },
  { name: 'Glimmer alone: 24', at: 95.3, played: 79.55, section: 8, word: 'Glimmer' },
  { name: '43 of 48 holds', at: 96.9, played: 80.83, section: 8, word: 'twenty-four' },
  { name: 'beside the window', at: 97.7, played: 81.64, section: 8, word: 'And' },
  { name: '12', at: 99.7, played: 83.26, section: 8, word: 'twelve' },
  { name: 'up from 9', at: 100.9, played: 84.54, section: 8, word: 'nine' },
  { name: 'onto the certificate', at: 102.9, played: 86.19, section: 9, word: 'Architect' },
  { name: 'the risk certificate', at: 104.5, played: 87.74, section: 9, word: 'specialists' },
  { name: 'wrong at most, beside the window', at: 106.9, played: 89.38, section: 9, word: 'wrong' },
  {
    name: 'Harborview Prep: 53 of 54, 0 wrong',
    at: 111.5,
    played: 94.26,
    section: 9,
    word: '(before) held',
  },
  { name: 'the fine-tune', at: 113.7, played: 97.26, section: 9, word: 'when (the harness)' },
  { name: 'Read config', at: 115.2, played: 98.56, section: 9, word: 'enough' },
  { name: "the model's figures", at: 116.5, played: 100.16, section: 9, word: 'weights' },
  { name: 'LoRA chosen', at: 117.2, played: 100.89, section: 9, word: 'LoRA' },
  { name: "the plan's memory card", at: 118.1, played: 102.25, section: 9, word: '(before) sized' },
  { name: '235.1B parameters, LoRA', at: 118.6, played: 102.75, section: 9, word: 'sized' },
  { name: '16 GPUs, in 2 nodes', at: 119.6, played: 103.86, section: 9, word: 'config' },
  {
    name: 'Glimmer, QLoRA: 1 A100, trained in 8 min',
    at: 120.8,
    played: 104.9,
    section: 9,
    word: 'single',
  },
  { name: '1 GPU holds', at: 122.2, played: 106.28, section: 9, word: 'packaged' },
  { name: 'Slurm', at: 123.2, played: 107.2, section: 9, word: 'Slurm' },
  { name: 'Kubernetes', at: 124, played: 107.81, section: 9, word: 'Kubernetes' },
  { name: 'the open teacher', at: 125.6, played: 109.02, section: 9, word: '(before) Even' },
  { name: 'Muse Spark Open', at: 128.2, played: 111.86, section: 9, word: 'Muse' },
  {
    name: 'the line: Not just academies.',
    at: 130.6,
    played: 115.3,
    section: 10,
    word: '(before) And',
  },
  {
    name: 'the screening field whips in',
    at: 132.2,
    played: 116.54,
    section: 10,
    word: 'academies',
  },
  {
    name: 'the screening lab desks lit',
    at: 134.8,
    played: 119.37,
    section: 10,
    word: 'screening',
  },
  {
    name: 'the dive into Inventory desk',
    at: 138.2,
    played: 122.2,
    section: 10,
    word: '(before) never',
  },
  { name: 'Corvid Hill Discovery rises', at: 138.8, played: 122.85, section: 10, word: 'seen' },
  { name: '27 rises', at: 139.45, played: 123.7, section: 10, word: '(just before) twenty-seven' },
  { name: '27 of 32 lands', at: 139.9, played: 124.08, section: 10, word: 'twenty-seven' },
  { name: 'Glimmer alone: 4', at: 141.2, played: 126.03, section: 10, word: 'Glimmer' },
  {
    name: 'the line: Specialists work as a team.',
    at: 142.5,
    played: 127.4,
    section: 10,
    word: 'four',
  },
  { name: 'the team line holds', at: 143.4, played: 128.34, section: 10, word: 'specialists' },
  { name: 'a whip to the team chat', at: 145, played: 129.37, section: 10, word: 'team' },
  { name: 'Asking Assay desk', at: 146.6, played: 131.43, section: 10, word: 'asks' },
  { name: 'the compounds', at: 147.8, played: 132.81, section: 10, word: 'compounds' },
  { name: 'the hold', at: 149.8, played: 134.68, section: 10, word: 'reserves' },
  { name: 'the line: Cut the network.', at: 152, played: 136.75, section: 11, word: 'Then' },
  { name: 'Offline', at: 153.2, played: 137.56, section: 11, word: 'network' },
  {
    name: 'up to the GPU, the model and its memory',
    at: 154.2,
    played: 138.68,
    section: 11,
    word: 'specialist',
  },
  { name: 'Allow once, saved', at: 158.6, played: 142.67, section: 11, word: 'writes' },
  { name: 'the two editions', at: 160, played: 143.67, section: 12, word: '(before) Architect' },
  { name: 'Architect Lab chosen', at: 163.4, played: 146.96, section: 12, word: 'Lab' },
  {
    name: 'the window becomes the mark',
    at: 165.8,
    played: 149.06,
    section: 12,
    word: '(before) Your',
  },
  { name: 'Your own AI.', at: 166.8, played: 149.96, section: 12, word: 'Your' },
  { name: 'Architect', at: 168.8, played: 151.71, section: 12, word: '(just before) Architect' },
  { name: 'end', at: 173, played: 157.23, section: 12, word: '(the score has faded)' },
];

/** The film's length as played, in seconds, from its own start: the lockup held to the score's fade. */
export const RUNTIME = 157.23;

/** How long before its own start the film's page begins: the founder's last second. */
export const PREROLL = 1.3;

/** [played, authored]: every beat. */
export const TIMING: readonly (readonly [number, number])[] = BEATS.map(
  (beat) => [beat.played, beat.at] as const,
);
