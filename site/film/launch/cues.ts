import { SHOW_OPEN_TEACHER } from './data';
import { DURATION, T } from './timeline';

/**
 * The launch film's timing. The picture is authored on its own clock (timeline.ts) at about 150
 * words a minute of the script (SCRIPT-launch.md, draft 2). Once the voice is recorded, each beat
 * below is paired with the time its word is said, and TIMING maps the film as played onto the
 * authored clock through one smooth curve (time.ts, `smoothMap`), as site/film/lab/cues.ts does
 * for the walkthrough.
 */

export interface Beat {
  name: string;
  /** Authored second. */
  at: number;
  /** The script's section (1 to 12), and the word it lands on; "(before) x" lands just before it. */
  section: number;
  word: string;
}

const beats: (Beat | false)[] = [
  { name: 'claim rises', at: T.claim, section: 1, word: 'Every' },
  { name: 'first screen arrives', at: T.arrive[0], section: 1, word: 'knows (a little)' },
  { name: 'last screen arrives', at: T.arrive[3], section: 1, word: 'everything' },
  { name: 'flight through the screens', at: T.hits[0], section: 1, word: 'Architect' },
  { name: 'flight lands', at: T.hits[3] + 0.95, section: 1, word: '(after) it' },
  { name: 'YC line', at: T.asked, section: 2, word: 'Y Combinator' },
  { name: 'first request', at: T.requests[0], section: 2, word: 'Own' },
  { name: 'second request', at: T.requests[1], section: 2, word: 'AI (for the air-gapped)' },
  { name: 'third request', at: T.requests[2], section: 2, word: 'vertical' },
  { name: 'on to the Lab', at: T.toLab, section: 3, word: '(before) This' },
  { name: 'Architect Lab beside its window', at: T.labWide, section: 3, word: 'This' },
  { name: 'the Lab, whole', at: T.how, section: 3, word: 'Spark' },
  { name: 'push onto the Lab', at: T.pushRunning, section: 3, word: "Meta's" },
  { name: 'Fields clicked', at: T.fields, section: 4, word: 'Point' },
  { name: 'academy row lit', at: T.academyLit, section: 4, word: 'academies' },
  { name: 'the field', at: T.field, section: 4, word: 'Glimmer (trains)' },
  { name: 'first academy sealed', at: T.sealed + 0.4, section: 4, word: 'sealed' },
  { name: 'the vault: Harborview sealed', at: T.vault, section: 4, word: 'vault' },
  { name: 'back to the real academy', at: T.real, section: 4, word: 'real' },
  { name: 'Define, the brief', at: T.define, section: 5, word: 'Spark (reads)' },
  { name: 'passages open', at: T.source, section: 5, word: 'every (rule traced)' },
  { name: 'Confirm pressed', at: T.confirm, section: 6, word: '(before) Then' },
  { name: 'Train', at: T.train, section: 6, word: 'Then' },
  { name: 'the harness drawer', at: T.harness, section: 6, word: 'harness' },
  { name: 'prompt, tool, lesson', at: T.prompts, section: 6, word: 'prompts' },
  { name: 'round 2, its change line by line', at: T.hypothesis, section: 6, word: 'hypothesis' },
  { name: 'rolled back', at: T.rolledBack, section: 6, word: 'rolled' },
  { name: 'into the score', at: T.pushScore, section: 6, word: '(before) Thirty-five' },
  { name: '97%, 35 of 36', at: T.thirtyFive, section: 6, word: 'Thirty-five' },
  { name: 'the counterexample', at: T.drawer, section: 7, word: 'When' },
  { name: 'the table shrinks', at: T.drawer + 2.0, section: 7, word: 'hunts' },
  { name: '4 rows', at: T.four, section: 7, word: 'four' },
  { name: 'repaired', at: T.fixed, section: 7, word: 'Repaired' },
  { name: 'the regression suite', at: T.assets, section: 7, word: 'locked' },
  { name: 'the case locked in', at: T.regression, section: 7, word: 'regression' },
  { name: 'the vault again', at: T.vaultPage, section: 8, word: 'Then (the vault)' },
  { name: 'the lock opens', at: T.opens, section: 8, word: 'opens' },
  { name: 'the dive past the lock', at: T.dive, section: 8, word: '(after) opens' },
  { name: 'Harborview Prep rises', at: T.hero, section: 8, word: 'academy' },
  { name: '43 of 48', at: T.fortyThree, section: 8, word: 'Forty-three' },
  { name: 'Glimmer alone: 24', at: T.fortyThree + 1.3, section: 8, word: 'Glimmer (alone)' },
  { name: 'back into the plot', at: T.resolve, section: 8, word: '(after) twenty-four' },
  { name: 'beside the window', at: T.side, section: 8, word: 'And (at the real academy)' },
  { name: '12', at: T.twelve, section: 8, word: 'twelve' },
  { name: 'up from 9', at: T.nine, section: 8, word: 'nine' },
  { name: 'Models', at: T.models, section: 9, word: 'Architect (certifies)' },
  { name: 'the risk certificate', at: T.panel, section: 9, word: 'specialists' },
  { name: 'the bound drawn', at: T.bound, section: 9, word: 'bound' },
  { name: 'the certificate (open line)', at: T.certificate, section: 9, word: 'its first word' },
  { name: 'Compute', at: T.compute, section: 9, word: 'And (when the harness)' },
  { name: 'Read config', at: T.readConfig, section: 9, word: 'enough' },
  { name: "the model's figures", at: T.weights, section: 9, word: 'weights' },
  { name: 'LoRA chosen', at: T.lora, section: 9, word: 'LoRA' },
  { name: 'the plan read from the config, held', at: T.config, section: 9, word: 'config' },
  { name: 'the dive into the memory card', at: T.gpuDive, section: 9, word: 'on (a single GPU)' },
  { name: '16 GPUs, in 2 nodes', at: T.gpuHero, section: 9, word: 'GPU' },
  { name: 'back to the plan', at: T.gpuResolve, section: 9, word: 'across' },
  { name: 'Slurm', at: T.slurm, section: 9, word: 'Slurm' },
  { name: 'Kubernetes', at: T.kubernetes, section: 9, word: 'Kubernetes' },
  SHOW_OPEN_TEACHER && { name: 'the open teacher', at: T.openBeat, section: 9, word: 'Even' },
  SHOW_OPEN_TEACHER && { name: 'Muse Spark Open', at: T.muse, section: 9, word: 'Muse' },
  { name: 'Fields again', at: T.beyond, section: 10, word: '(before) And' },
  { name: 'academy row lit', at: T.notJust + 1.2, section: 10, word: 'academies' },
  { name: 'the screening lab desks lit', at: T.labDesks, section: 10, word: 'screening' },
  { name: 'the dive into Inventory desk', at: T.scienceDive, section: 10, word: 'never' },
  { name: 'Corvid Hill Discovery rises', at: T.scienceHero, section: 10, word: 'seen' },
  { name: '27 of 32', at: T.twentySeven, section: 10, word: 'twenty-seven' },
  { name: 'Glimmer alone: 4', at: T.twentySeven + 1.3, section: 10, word: 'Glimmer (alone)' },
  { name: 'back to Fields', at: T.scienceResolve, section: 10, word: '(after) four' },
  {
    name: 'the sidebar turns to the team',
    at: T.teamScroll,
    section: 10,
    word: 'And (specialists)',
  },
  { name: 'the team chat', at: T.teamClick, section: 10, word: 'team' },
  { name: 'Asking Assay desk', at: T.asks, section: 10, word: 'asks' },
  { name: 'the compounds', at: T.compounds, section: 10, word: 'compounds' },
  { name: 'the hold', at: T.holds, section: 10, word: 'reserves' },
  { name: 'the academy chat', at: T.workspace, section: 11, word: 'Then (cut)' },
  { name: 'Offline', at: T.network, section: 11, word: 'network' },
  { name: 'the answer', at: T.keeps, section: 11, word: 'specialist' },
  { name: 'Allow once, saved', at: T.saves, section: 11, word: 'writes' },
  { name: 'the two editions', at: T.welcome, section: 12, word: 'Architect (for one job)' },
  { name: 'Architect Lab chosen', at: T.labEdition, section: 12, word: 'Lab' },
  { name: 'the window becomes the mark', at: T.morph, section: 12, word: '(before) Your' },
  { name: 'Your own AI.', at: T.ownAI, section: 12, word: 'Your' },
  { name: 'Architect', at: T.architect, section: 12, word: 'Architect' },
  { name: 'end', at: DURATION, section: 12, word: '(after the last word)' },
];

/** In film order, so they pair with the take's word times as they come. */
export const BEATS: readonly Beat[] = beats
  .filter((beat): beat is Beat => beat !== false)
  .sort((a, b) => a.at - b.at);

/** The film's length as played, in seconds. */
export const RUNTIME = DURATION;

/**
 * [played, authored] pairs: placeholders until the voice is recorded, when each beat's authored
 * second is paired with its word's time in the take.
 */
export const TIMING: readonly (readonly [number, number])[] = [
  [0, 0],
  [RUNTIME, DURATION],
];
