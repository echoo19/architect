/**
 * The launch film's timing, written by architect-runs/film/launch/audio/final7/cues.mts from the
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
    name: 'the training screen pushes into his window, on the drop',
    at: 0.6,
    played: 0.45,
    section: 1,
    word: '(the drop before) Every',
  },
  { name: 'the training screen, Spark at work', at: 1.6, played: 1.54, section: 1, word: 'knows' },
  { name: 'onto the score', at: 4.3, played: 3.62, section: 1, word: 'Your' },
  { name: 'the score holds', at: 8.8, played: 6.73, section: 1, word: 'Architect' },
  { name: 'YC line', at: 10.85, played: 8.34, section: 2, word: 'Y Combinator' },
  { name: 'first request', at: 14.6, played: 11.7, section: 2, word: 'Own' },
  { name: 'second request', at: 19, played: 14.19, section: 2, word: 'AI' },
  { name: 'third request', at: 22.8, played: 17.57, section: 2, word: 'And (vertical)' },
  { name: 'on to the Lab', at: 27.6, played: 20.46, section: 2, word: '(after) check' },
  { name: 'Architect Lab beside its window', at: 29, played: 21.82, section: 3, word: 'This' },
  { name: 'the Lab, whole', at: 33.8, played: 26.16, section: 3, word: 'Spark' },
  { name: 'push onto the Lab', at: 34.6, played: 26.64, section: 3, word: "Meta's" },
  { name: 'the teaching run lit', at: 35.9, played: 27.96, section: 3, word: 'trains' },
  { name: 'the line: Give it a field.', at: 40.6, played: 32.59, section: 4, word: 'Give' },
  { name: 'the field whips in', at: 42.2, played: 34.07, section: 4, word: 'academies' },
  { name: 'the field', at: 43.7, played: 35.36, section: 4, word: 'Glimmer' },
  { name: 'the vault: Harborview sealed', at: 47.7, played: 38.42, section: 4, word: 'vault' },
  {
    name: 'back to the real academy',
    at: 49.5,
    played: 40.29,
    section: 4,
    word: 'one (of them is real)',
  },
  { name: 'Define, the brief', at: 51.8, played: 41.73, section: 5, word: 'Spark' },
  { name: 'passages open', at: 56.2, played: 45.44, section: 5, word: 'every (rule)' },
  { name: 'Confirm pressed', at: 60, played: 47.58, section: 5, word: '(after) source' },
  { name: 'Train', at: 60.3, played: 47.75, section: 6, word: 'Then' },
  { name: 'the harness drawer', at: 62.4, played: 49.09, section: 6, word: 'harness' },
  { name: 'a prompt', at: 63.5, played: 49.86, section: 6, word: 'prompts' },
  { name: 'a tool', at: 64.65, played: 50.58, section: 6, word: 'tools' },
  { name: 'a lesson', at: 65.3, played: 51.37, section: 6, word: 'lessons' },
  {
    name: 'round 2, its change line by line',
    at: 66.3,
    played: 52.41,
    section: 6,
    word: 'Every (change)',
  },
  { name: 'measured where Spark never sees', at: 68.4, played: 54.11, section: 6, word: 'tested' },
  { name: 'rolled back', at: 72.5, played: 57.73, section: 6, word: 'rolled' },
  { name: '97%, 35 of 36', at: 75.4, played: 59.05, section: 6, word: 'Thirty-five' },
  { name: 'the counterexample', at: 77.5, played: 60.72, section: 7, word: 'When' },
  { name: 'the table shrinks', at: 79.5, played: 62.49, section: 7, word: 'hunts' },
  { name: '4 rows', at: 83.3, played: 65.25, section: 7, word: 'four' },
  { name: 'repaired', at: 85.1, played: 66.36, section: 7, word: 'Repaired' },
  { name: 'the case locked in', at: 86.8, played: 67.14, section: 7, word: 'regression' },
  { name: 'the vault again', at: 88.9, played: 68.83, section: 8, word: 'Then' },
  { name: 'the lock opens', at: 90, played: 69.72, section: 8, word: 'opens' },
  { name: 'Harborview Prep rises', at: 90.95, played: 70.26, section: 8, word: 'academy' },
  {
    name: '43 rises on the drop',
    at: 93.9,
    played: 72.45,
    section: 8,
    word: '(the drop before) Forty-three',
  },
  { name: '43 of 48 lands', at: 94.3, played: 72.78, section: 8, word: 'Forty-three' },
  { name: 'Glimmer alone: 24', at: 95.6, played: 73.84, section: 8, word: 'Glimmer' },
  { name: '43 of 48 holds', at: 97.2, played: 75.16, section: 8, word: 'twenty-four' },
  { name: 'beside the window', at: 98, played: 75.84, section: 8, word: 'And' },
  { name: '12', at: 100, played: 77.29, section: 8, word: 'twelve' },
  { name: 'up from 9', at: 101.2, played: 78.36, section: 8, word: 'nine' },
  { name: 'onto the certificate', at: 103.2, played: 80.49, section: 9, word: 'Architect' },
  { name: 'the risk certificate', at: 104.8, played: 81.92, section: 9, word: 'specialists' },
  { name: 'wrong at most, beside the window', at: 107.2, played: 83.41, section: 9, word: 'wrong' },
  {
    name: 'Harborview Prep: 53 of 54, 0 wrong',
    at: 111.8,
    played: 87.86,
    section: 9,
    word: '(before) held',
  },
  { name: 'the fine-tune', at: 114, played: 91.02, section: 9, word: 'when (the harness)' },
  { name: 'Read config', at: 115.5, played: 92.29, section: 9, word: 'enough' },
  { name: "the model's figures", at: 116.8, played: 93.71, section: 9, word: 'weights' },
  { name: 'LoRA chosen', at: 117.5, played: 94.34, section: 9, word: 'LoRA' },
  { name: "the plan's memory card", at: 118.4, played: 95.66, section: 9, word: '(before) sized' },
  { name: '235.1B parameters, LoRA', at: 118.9, played: 96.16, section: 9, word: 'sized' },
  { name: '16 GPUs, in 2 nodes', at: 119.9, played: 97.22, section: 9, word: 'config' },
  {
    name: 'Glimmer, QLoRA: 1 A100, trained in 8 min',
    at: 121.1,
    played: 98.23,
    section: 9,
    word: 'single',
  },
  { name: '1 GPU holds', at: 122.5, played: 99.71, section: 9, word: 'packaged' },
  { name: 'Slurm', at: 123.5, played: 100.57, section: 9, word: 'Slurm' },
  { name: 'Kubernetes', at: 124.3, played: 101.13, section: 9, word: 'Kubernetes' },
  { name: 'the open teacher', at: 125.9, played: 102.17, section: 9, word: '(before) Even' },
  { name: 'Muse Spark Open', at: 128.5, played: 104.81, section: 9, word: 'Muse' },
  {
    name: 'the line: Not just academies.',
    at: 130.9,
    played: 108.54,
    section: 10,
    word: '(before) And',
  },
  {
    name: 'the screening field whips in',
    at: 132.5,
    played: 109.77,
    section: 10,
    word: 'academies',
  },
  {
    name: 'the screening lab desks lit',
    at: 135.1,
    played: 112.24,
    section: 10,
    word: 'screening',
  },
  {
    name: 'the dive into Inventory desk',
    at: 138.5,
    played: 114.74,
    section: 10,
    word: '(before) never',
  },
  { name: 'Corvid Hill Discovery rises', at: 139.1, played: 115.35, section: 10, word: 'seen' },
  {
    name: '27 rises on the drop',
    at: 139.75,
    played: 116.09,
    section: 10,
    word: '(the drop before) twenty-seven',
  },
  { name: '27 of 32 lands', at: 140.2, played: 116.47, section: 10, word: 'twenty-seven' },
  { name: 'Glimmer alone: 4', at: 141.5, played: 117.96, section: 10, word: 'Glimmer' },
  {
    name: 'the line: Specialists work as a team.',
    at: 142.8,
    played: 119.18,
    section: 10,
    word: 'four',
  },
  { name: 'the team line holds', at: 143.7, played: 119.95, section: 10, word: 'specialists' },
  { name: 'a whip to the team chat', at: 145.3, played: 120.91, section: 10, word: 'team' },
  { name: 'Asking Assay desk', at: 146.9, played: 122.73, section: 10, word: 'asks' },
  { name: 'the compounds', at: 148.1, played: 124.04, section: 10, word: 'compounds' },
  { name: 'the hold', at: 150.1, played: 125.86, section: 10, word: 'reserves' },
  { name: 'the line: Cut the network.', at: 152.3, played: 128.19, section: 11, word: 'Then' },
  { name: 'Offline', at: 153.5, played: 128.93, section: 11, word: 'network' },
  {
    name: 'up to the GPU, the model and its memory',
    at: 154.5,
    played: 129.95,
    section: 11,
    word: 'specialist',
  },
  { name: 'Allow once, saved', at: 158.9, played: 133.37, section: 11, word: 'writes' },
  { name: 'the two editions', at: 160.3, played: 134.98, section: 12, word: '(before) Architect' },
  { name: 'Architect Lab chosen', at: 163.7, played: 137.95, section: 12, word: 'Lab' },
  {
    name: 'the window becomes the mark',
    at: 166.1,
    played: 139.83,
    section: 12,
    word: '(before) Your',
  },
  { name: 'Your own AI.', at: 167.1, played: 140.73, section: 12, word: 'Your' },
  {
    name: 'Architect, on the last drop',
    at: 169.1,
    played: 142.27,
    section: 12,
    word: '(the drop before) Architect',
  },
  { name: 'end', at: 173.3, played: 147.45, section: 12, word: '(the score fades)' },
];

/** The film's length as played, in seconds, from its own start: the lockup held to the score's fade. */
export const RUNTIME = 147.45;

/** How long before its own start the film's page begins: the founder's last second. */
export const PREROLL = 1.3;

/** [played, authored]: every beat. */
export const TIMING: readonly (readonly [number, number])[] = BEATS.map(
  (beat) => [beat.played, beat.at] as const,
);
