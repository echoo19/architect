/**
 * An Architect WSP experiment end to end on this computer, with no paid call: the real worker
 * (kernel, guard and evaluator), a real base model on the CPU, the vault and the sealed
 * qualification, and the scripted stand-in mentor in Astra's place. A developer tool; it is not
 * part of the app and never runs in CI.
 *
 *   ARCHITECT_WSP_MENTOR=stand-in pnpm --filter @architect/engine exec tsx scripts/wsp-demo.ts \
 *     <dataDir> <modelFolder> <envDir> [--qualify]
 *
 * <envDir> is a Python environment with trainer/wsp/requirements.txt installed. The record is
 * written to <dataDir>/wsp/experiments/<id>, and the result is printed as JSON.
 */
import { resolve } from 'node:path';
import { WSP_DEFAULT_LIMITS, type WspExample } from '@architect/shared';
import { Vault } from '../src/vault/vault';
import { standInMentor, WspService, wspMentorStatus } from '../src/wsp';

const [dataDir, modelFolder, envDir] = process.argv.slice(2);
if (!dataDir || !modelFolder || !envDir || process.env['ARCHITECT_WSP_MENTOR'] !== 'stand-in') {
  console.error('Usage: ARCHITECT_WSP_MENTOR=stand-in tsx scripts/wsp-demo.ts <dataDir> <modelFolder> <envDir> [--qualify]');
  process.exit(2);
}

/** Multi-step word problems, each with the number it comes to. */
const PROBLEMS: [string, number][] = [
  ["A jacket costs 80 dollars. It is discounted by 15 percent, then 8 percent sales tax is added to the discounted price. What is the final price in dollars?", 73.44],
  ["A worker is paid 17.50 dollars an hour for the first 40 hours and 1.5 times that rate for every hour over 40. How much is she paid for 46 hours?", 857.5],
  ["A meeting starts at 9:45 and lasts 2 hours and 50 minutes. How many minutes past noon does it end?", 35],
  ["There are 7 red, 5 blue and 12 green marbles in a bag. Half of the green ones and 3 of the red ones are removed. How many marbles are left?", 15],
  ["A number is tripled, then 14 is subtracted, and the result is 52. What was the number?", 22],
  ["A car travels 150 km in 2.5 hours. At the same speed, how many km does it travel in 4 hours?", 240],
  ["A shirt costs 24 dollars after a 20 percent discount. What was its original price in dollars?", 30],
  ["A rectangle has a perimeter of 54 cm and a length of 17 cm. What is its area in square cm?", 170],
  ["Of 240 students, 35 percent walk to school, 45 percent take the bus and the rest are driven. How many are driven?", 48],
  ["A tank is two fifths full and holds 36 litres now. How many litres does it hold when full?", 90],
  ["Anna is 4 times as old as her son. In 20 years she will be twice as old as him. How old is Anna now?", 40],
  ["A bakery makes 345 rolls and packs them in bags of 8. How many rolls are left over after filling as many bags as possible?", 1],
  ["A phone plan costs 12 dollars a month plus 0.05 dollars per text. In a month with 380 texts, what is the bill in dollars?", 31],
  ["The average of four numbers is 18. Three of them are 12, 20 and 25. What is the fourth?", 15],
  ["A train leaves at 22:40 and arrives at 03:15 the next day. How many minutes is the trip?", 275],
  ["A recipe for 6 people uses 450 grams of rice. How many grams are needed for 10 people?", 750],
  ["A shop buys a lamp for 40 dollars and sells it for 25 percent more. A customer returns it and gets 90 percent of the price back. How many dollars does the customer get back?", 45],
  ["Two pipes fill a pool. One fills 30 litres a minute and the other 45. How many minutes do they take together to fill 1500 litres?", 20],
  ["A square garden has an area of 196 square metres. What length of fence goes around it, in metres?", 56],
  ["A loan of 2000 dollars earns 5 percent simple interest a year. What is the total owed after 3 years, in dollars?", 2300],
  ["Sam has twice as many coins as Lee, and together they have 57. How many coins does Sam have?", 38],
  ["A store sells 3 notebooks for 7 dollars. How many dollars do 18 notebooks cost?", 42],
  ["A cyclist rides 18 km at 12 km an hour and then 24 km at 16 km an hour. How many hours does the ride take in all?", 3],
  ["A box of 50 tiles covers 4 square metres. How many boxes are needed to cover a floor of 37 square metres?", 10],
  ["The temperature is minus 7 degrees at dawn and rises 3 degrees each hour. What is it after 5 hours, in degrees?", 8],
  ["A school has 18 classes of 27 students. Each bus seats 52. How many buses are needed for a trip with every student?", 10],
];

const examples: WspExample[] = PROBLEMS.map(([prompt, answer]) => ({
  prompt: `${prompt} Give the final answer as a number.`,
  check: { kind: 'number', value: String(answer) },
}));

const root = resolve(dataDir);
const service = new WspService({
  dir: resolve(root, 'wsp'),
  sourceDir: resolve(import.meta.dirname, '..', '..', '..', 'trainer', 'wsp'),
  vault: new Vault(root),
  envDir: resolve(envDir),
  connectMentor: () => Promise.resolve(standInMentor()),
  mentorStatus: () => wspMentorStatus({ secrets: { get: () => Promise.resolve(undefined) } }),
});

const wait = (id: string, done: (status: string) => boolean) =>
  new Promise<void>((resolveWait) => {
    const check = () => {
      const experiment = service.get(id);
      process.stdout.write(`\r${experiment.status} ${experiment.stage}: ${experiment.activity}`.padEnd(110).slice(0, 110));
      if (done(experiment.status)) {
        process.stdout.write('\n');
        resolveWait();
      } else setTimeout(check, 2_000);
    };
    check();
  });

const drafted = await service.draft({
  modelPath: resolve(modelFolder),
  goal: {
    task: 'Solve two-step arithmetic word problems and end with the right number.',
    constraints: 'Keep answers short.',
    examples,
  },
  compute: 'local-cpu',
  limits: { ...WSP_DEFAULT_LIMITS, programs: 4, forwardPasses: 16, wallMinutes: 60, mentorUsd: 0 },
  reasoningEffort: 'high',
});
console.log(`Experiment ${drafted.id} on ${drafted.base.name} (${drafted.base.digest.slice(0, 12)})`);
await wait(drafted.id, (status) => status !== 'briefing');
service.start(drafted.id);
await wait(drafted.id, (status) => ['evaluated', 'failed', 'cancelled'].includes(status));
if (process.argv.includes('--qualify') && service.get(drafted.id).frozen !== null) {
  await service.qualify(drafted.id);
  await wait(drafted.id, (status) => status !== 'qualifying');
}
const final = service.get(drafted.id);
console.log(JSON.stringify({ id: final.id, status: final.status, error: final.error, iterations: final.iterations.map(({ output: _o, dev: _d, ...rest }) => rest), measurements: final.measurements.map(({ outcomes: _x, ...rest }) => rest), result: final.result, costs: final.costs, worker: final.worker && { ...final.worker, packages: final.worker.packages.length } }, null, 2));
