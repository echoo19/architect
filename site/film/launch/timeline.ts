import { SHOW_OPEN_TEACHER } from './data';

/**
 * The launch film's authored clock, in seconds. It is set at about 150 words a minute of the
 * script (SCRIPT-launch.md, draft 2): each moment names the words it waits for. cues.ts maps the
 * film as played onto this clock once the voice is recorded, so nothing here needs to move then.
 */

/** The open-weight teacher's beat, and how much of the film comes after it. */
const OPEN = SHOW_OPEN_TEACHER ? 4.4 : 0;

/** Everything after the beat moves by its length; with the beat gone, the film closes the gap. */
const late = (at: number) => at + OPEN;

export const T = {
  // 1. Hook: "Every frontier model knows a little about everything. Your work needs a
  // specialist that knows it inside out. Architect builds it." The claim, the screens arriving in depth, and the
  // flight through them on "Architect builds it".
  claim: 0.35,
  arrive: [1.6, 2.5, 3.4, 4.3] as const,
  hits: [8.8, 9.45, 10.1, 10.75] as const,

  // 2. Why: the line, then the three requests, a camera move between each.
  asked: 10.85,
  requests: [14.6, 19.0, 22.8] as const,
  toLab: 27.6,

  // 3. "This is Architect Lab, an R&D platform for specialist models. Spark, Meta's frontier
  // model, trains Glimmer, a thirty-billion-parameter model small enough for a PC." The Lab's
  // window arrives beside its name, then the camera takes it whole.
  labWide: 29.0,
  how: 33.8,
  pushRunning: 34.6,

  // 4. "Point it at a field: test-prep academies. Glimmer trains on three. Two are sealed in a
  // vault until the final test, and one of them is real."
  fields: 40.6,
  academyLit: 42.7,
  field: 43.7,
  sealed: 46.1,
  vault: 47.7,
  real: 49.5,

  // 5. "Spark reads every file and distills the field into a brief, every rule traced to its
  // source."
  define: 51.8,
  source: 56.2,
  confirm: 60.0,

  // 6. "Then it engineers Glimmer's harness: its prompts, its tools, its lessons. Every change is
  // a hypothesis, tested on tasks Spark never sees. If it doesn't win, it's rolled back.
  // Thirty-five of thirty-six."
  train: 60.3,
  harness: 62.4,
  prompts: 62.8,
  hypothesis: 65.9,
  rolledBack: 71.8,
  harnessOut: 72.6,
  pushScore: 73.7,
  thirtyFive: 74.7,

  // 7. "When a tool breaks, Architect hunts down the failure. Two thousand rows, shrunk to four.
  // Repaired, and locked in as a regression test."
  drawer: 76.8,
  four: 82.6,
  fixed: 84.4,
  drawerOut: 85.3,
  assets: 85.8,
  regression: 86.5,

  // 8. "Then the vault opens: an academy neither model ever saw. Forty-three of forty-eight.
  // Glimmer alone, twenty-four. And at the real academy, twelve, up from nine."
  vaultPage: 88.2,
  opens: 89.3,
  dive: 89.7,
  hero: 90.25,
  vaultCut: 91.2,
  fortyThree: 93.6,
  resolve: 96.5,
  side: 98.0,
  twelve: 100.2,
  nine: 101.4,

  // 9. "Architect certifies its specialists, with a statistical bound on how often they're
  // wrong. And when the harness isn't enough, it fine-tunes the weights: LoRA and QLoRA, sized
  // from the model's own config, on a single GPU or across a Slurm or Kubernetes cluster."
  models: 103.4,
  panel: 105.0,
  bound: 106.6,
  certificate: 109.4,
  compute: 111.6,
  readConfig: 113.1,
  weights: 114.4,
  lora: 116.2,
  config: 117.6,
  gpu: 120.2,
  gpuDive: 119.7,
  gpuHero: 120.2,
  gpuResolve: 122.4,
  slurm: 123.4,
  kubernetes: 124.2,
  cluster: 125.0,
  // "Even the teacher can be open weights: Muse Spark Open."
  openBeat: 125.7,
  muse: 128.3,

  // 10. "And it's not just academies. Inventory desk learned a screening lab's stock on three
  // labs, then went to one it had never seen: twenty-seven of thirty-two. Glimmer alone, four.
  // And specialists work as a team: Inventory desk asks Assay desk which compounds need a
  // re-test, then reserves the stock."
  beyond: late(125.9),
  notJust: late(126.3),
  labDesks: late(130.1),
  neverSeen: late(132.9),
  scienceDive: late(133.9),
  scienceHero: late(134.5),
  twentySeven: late(135.9),
  scienceResolve: late(138.3),
  teamScroll: late(139.7),
  teamClick: late(141.3),
  asks: late(144.1),
  compounds: late(145.3),
  holds: late(147.3),

  // 11. "Then cut the network. The specialist runs on-premise, on your own machine, and asks
  // before it writes."
  backScroll: late(148.7),
  workspace: late(149.5),
  network: late(150.7),
  keeps: late(151.7),
  saves: late(156.1),

  // 12. "Architect, for one job. Architect Lab, R&D for an entire field. Your own AI. Architect."
  welcome: late(157.7),
  oneJob: late(158.3),
  labEdition: late(161.1),
  morph: late(163.5),
  ownAI: late(164.5),
  architect: late(166.5),
  fade: late(169.8),
} as const;

/** The film's length on its own clock. */
export const DURATION = late(170.7);
