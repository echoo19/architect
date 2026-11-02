import { SHOW_OPEN_TEACHER } from './data';

/**
 * The launch film's authored clock, in seconds. Each scene's moments are set from the one before,
 * close to how long the narration (SCRIPT-launch.md, the recorded take) gives them, so the
 * played film (cues.ts) never has to run a stretch much faster than it was made.
 */

// 0. The founder's last line, "Here's how it works.", before the film's own clock starts: his frame
// recedes into a window, and on the score's first drop the training screen pushes into it.
const founder = -1.3;

// 1. Hook: "Every frontier model knows a little about everything. Your work needs a specialist
// that knows it inside out. Architect builds it." The training screen takes the founder's place,
// the camera goes onto its score as it climbs past the target, and holds it on "Architect builds
// it" before one move across to the requests.
const builds = 8.8;

// 2. Why: the line, then the three requests, a camera move between each.
const asked = 10.85;
const requests = [15.7, 18.35, 22.2] as const;
const toLab = 27.6;

// 3. "This is Architect Lab, an R&D platform for specialist models. Spark, Meta's frontier
// model, trains Glimmer, a thirty-billion-parameter model small enough for a PC."
const labWide = 29.0;
const how = 33.8;

// 4. "Give it a field: test-prep academies. Glimmer trains on three. Two are sealed in a vault
// until the final test, and one of them is real."
const fields = 40.6;
const field = 43.7;
const vault = 47.7;
const real = 49.5;

// 5. "Spark reads every file and distills the field into a brief, every rule traced to its source."
const define = 51.8;
const confirm = 60.0;

// 6. "Then it engineers Glimmer's harness: its prompts, its tools, its lessons. Every change is a
// hypothesis, tested on tasks Spark never sees. If it doesn't win, it's rolled back.
// Thirty-five of thirty-six." The harness drawer's moments follow the words one to one.
const train = 60.15;
const harness = 62.4;
const rolledBack = harness + 10.1;
const thirtyFive = rolledBack + 2.6;

// 7. "When a tool breaks, Architect hunts down the failure. Two thousand rows, shrunk to four.
// Repaired, and locked in as a regression test."
const drawer = thirtyFive + 2.1;
const fixed = drawer + 7.6;
const regression = fixed + 1.7;

// 8. "Then the vault opens: an academy neither model ever saw. Forty-three of forty-eight. Glimmer
// alone, twenty-four. And at the real academy, twelve, up from nine."
const vaultPage = regression + 2.1;
const hero = vaultPage + 2.05;
const fortyThree = hero + 3.35;
const resolve = fortyThree + 2.9;
const side = resolve + 0.8;
const twelve = side + 2.0;

// 9. "Architect certifies its specialists. This one is wrong on at most five percent of what it
// answers, with ninety-five percent confidence, and it held on an academy it never trained on.
// And when the harness isn't enough, it fine-tunes the weights: LoRA and Q-LoRA, sized from the
// model's own config, on a single GPU, or packaged for a Slurm or Kubernetes cluster. Even the teacher
// can be open weights: Muse Spark Open, on Baseten."
const models = twelve + 3.2;
const panel = models + 1.6;
const certHero = panel + 2.4;
const certificate = certHero + 4.6;
const compute = certificate + 2.2;
const lora = compute + 3.5;
const gpuDive = lora + 0.9;
const gpuResolve = gpuDive + 4.1;
const slurm = gpuResolve + 1.0;
const kubernetes = slurm + 0.8;
const openBeat = kubernetes + 1.6;
const muse = openBeat + 2.6;

// 10. "And it's not just academies. Inventory desk learned how three screening labs manage their
// stock, then went to a lab it had never seen: twenty-seven of thirty-two. Glimmer alone, four.
// And specialists work as a team: Inventory desk asks Assay desk which compounds need a re-test,
// then reserves the stock." With the open teacher's beat gone, it follows Kubernetes.
const beyond = SHOW_OPEN_TEACHER ? muse + 2.4 : kubernetes + 1.6;
const scienceDive = beyond + 7.6;
const twentySeven = scienceDive + 1.7;
const scienceResolve = twentySeven + 2.6;
const teamScroll = scienceResolve + 0.9;
const teamClick = teamScroll + 1.6;
const asks = teamClick + 1.6;
const holds = asks + 3.2;

// 11. "Then cut the network. The specialist runs on-premise, on your own machine, and asks before
// it writes." Academy desk's home: its Offline row as the network goes, its GPU, model and
// memory, then on into its chat, where Allow is pressed on "writes".
const workspace = holds + 2.2;
const saves = workspace + 6.6;

// 12. "Architect, for one job. Architect Lab, R&D for an entire field. Your own AI. Architect."
const welcome = saves + 1.4;
const morph = welcome + 5.8;
const architect = morph + 3.0;

export const T = {
  founder,
  recede: founder + 0.4,
  trainRises: 0.6,
  trainShown: 1.6,
  trainPush: 4.3,
  /** The score lands on its target. */
  scoreLands: builds - 0.64,
  builds,
  asked,
  requests,
  toLab,
  labWide,
  how,
  pushRunning: how + 0.8,
  labHover: how + 2.1,
  fields,
  /** The window whips back in onto the field, landing on "academies". */
  fieldIn: field - 1.5,
  field,
  vault,
  real,
  define,
  source: define + 4.4,
  confirm,
  train,
  harness,
  prompts: harness + 1.1,
  tools: harness + 2.25,
  lessons: harness + 2.9,
  hypothesis: harness + 3.9,
  blind: harness + 6.0,
  rolledBack,
  harnessOut: rolledBack + 0.8,
  pushScore: thirtyFive - 1.0,
  thirtyFive,
  drawer,
  four: drawer + 5.8,
  fixed,
  regression,
  /** The drawer closes as the vault's page pushes in. */
  drawerOut: vaultPage - 1.0,
  vaultPage,
  opens: vaultPage + 1.1,
  grows: vaultPage + 1.9,
  hero,
  vaultCut: hero + 0.95,
  fortyThree,
  /** 43 of 48 rises on the score's drop, landing on its word. */
  fortyThreeRises: fortyThree - 0.4,
  alone: fortyThree + 1.3,
  resolve,
  side,
  twelve,
  nine: twelve + 1.2,
  /** The real academy's whole figure takes the sealed one's place, on "real academy". */
  realAcademy: side + 0.1,
  models,
  /** The window flies back in from the right onto the certificate as the figure goes. */
  toModels: models - 0.5,
  panel,
  certHero,
  certificate,
  compute,
  readConfig: compute + 1.5,
  weights: compute + 2.8,
  lora,
  fit: lora + 0.4,
  config: lora + 1.2,
  gpuDive,
  gpuHero: gpuDive + 0.5,
  gpuNumber: gpuDive + 1.5,
  gpuTrained: gpuDive + 2.7,
  gpuResolve,
  slurm,
  kubernetes,
  openBeat,
  muse,
  beyond,
  notJust: beyond + 0.4,
  labDesks: beyond + 4.2,
  scienceDive,
  scienceHero: scienceDive + 0.6,
  twentySeven,
  /** 27 of 32 rises on the score's drop, landing on its word. */
  twentySevenRises: twentySeven - 0.45,
  scienceAlone: twentySeven + 1.3,
  scienceResolve,
  teamScroll,
  teamClick,
  asks,
  compounds: asks + 1.2,
  holds,
  backScroll: workspace - 0.8,
  workspace,
  network: workspace + 1.2,
  /** The Offline row turns as the window lands back from the line. */
  offline: workspace + 1.6,
  machine: workspace + 2.3,
  intoChat: saves - 1.0,
  saves,
  welcome,
  oneJob: welcome + 0.6,
  labEdition: welcome + 3.4,
  morph,
  ownAI: morph + 1.0,
  architect,
  fade: architect + 3.0,
} as const;

/** The film's length on its own clock. */
export const DURATION = T.fade + 1.2;
