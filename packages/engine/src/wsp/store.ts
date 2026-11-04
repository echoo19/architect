import { existsSync, mkdirSync, readdirSync, readFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CodedError,
  WspExampleSchema,
  WspExperimentSchema,
  type WspExample,
  type WspExperiment,
} from '@architect/shared';
import { z } from 'zod';
import { writeFileAtomic } from '../data/atomic-write';

/*
 * Where an Architect WSP experiment keeps its records (decision 109), one folder each:
 *
 *   experiment.json      the record the screens read
 *   examples.json        the practice and dev examples (the sealed ones are only in the vault)
 *   programs/<n>.py      each program as it ran
 *   kernel/<n>/          what each program handed back
 *   candidates/<id>/     manifest.json and tensors.safetensors, never changed once written
 *   outputs/             every evaluation's raw outputs
 *   reads/, scratch/     hidden states the runner read, and the programs' own files
 *   journal.jsonl        every mentor call, with its tokens and cost
 */

const ExamplesSchema = z.object({
  practice: z.array(WspExampleSchema),
  dev: z.array(WspExampleSchema),
});
export type StoredExamples = z.infer<typeof ExamplesSchema>;

export class WspStore {
  constructor(readonly root: string) {
    mkdirSync(this.experiments, { recursive: true });
  }

  get experiments(): string {
    return join(this.root, 'experiments');
  }

  get envDir(): string {
    return join(this.root, 'python');
  }

  dir(id: string): string {
    if (!/^wsp-[0-9a-z]{6,40}$/.test(id)) throw new Error(`"${id}" is not an experiment id.`);
    return join(this.experiments, id);
  }

  sub(id: string, ...parts: string[]): string {
    const path = join(this.dir(id), ...parts);
    return path;
  }

  exists(id: string): boolean {
    return existsSync(join(this.dir(id), 'experiment.json'));
  }

  get(id: string): WspExperiment {
    const path = join(this.dir(id), 'experiment.json');
    if (!existsSync(path)) {
      throw new CodedError('experiment_not_found', `There is no experiment "${id}".`);
    }
    return WspExperimentSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
  }

  save(experiment: WspExperiment): WspExperiment {
    const parsed = WspExperimentSchema.parse(experiment);
    mkdirSync(this.dir(parsed.id), { recursive: true });
    writeFileAtomic(join(this.dir(parsed.id), 'experiment.json'), JSON.stringify(parsed, null, 2));
    return parsed;
  }

  list(): WspExperiment[] {
    return readdirSync(this.experiments)
      .filter((name) => existsSync(join(this.experiments, name, 'experiment.json')))
      .map((name) => this.get(name))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  saveExamples(id: string, examples: StoredExamples): void {
    writeFileAtomic(join(this.dir(id), 'examples.json'), JSON.stringify(ExamplesSchema.parse(examples)));
  }

  examples(id: string): StoredExamples {
    return ExamplesSchema.parse(JSON.parse(readFileSync(join(this.dir(id), 'examples.json'), 'utf8')));
  }

  programFile(id: string, n: number): string {
    return join(this.dir(id), 'programs', `${n}.py`);
  }

  saveProgram(id: string, n: number, source: string): void {
    mkdirSync(join(this.dir(id), 'programs'), { recursive: true });
    writeFileAtomic(this.programFile(id, n), source);
  }

  program(id: string, n: number): string {
    const path = this.programFile(id, n);
    if (!existsSync(path)) throw new CodedError('record_not_found', `Program ${n} of ${id} isn't recorded.`);
    return readFileSync(path, 'utf8');
  }

  programs(id: string): Map<number, string> {
    const dir = join(this.dir(id), 'programs');
    if (!existsSync(dir)) return new Map();
    return new Map(
      readdirSync(dir)
        .filter((name) => /^\d+\.py$/.test(name))
        .map((name) => [Number(name.slice(0, -3)), readFileSync(join(dir, name), 'utf8')]),
    );
  }

  saveOutputs(id: string, name: string, value: unknown): void {
    const dir = join(this.dir(id), 'outputs');
    mkdirSync(dir, { recursive: true });
    writeFileAtomic(join(dir, `${name}.json`), JSON.stringify(value));
  }

  outputs<T>(id: string, name: string, schema: z.ZodType<T>): T | null {
    const path = join(this.dir(id), 'outputs', `${name}.json`);
    return existsSync(path) ? schema.parse(JSON.parse(readFileSync(path, 'utf8'))) : null;
  }

  journal(id: string, entry: Record<string, unknown>): void {
    appendFileSync(join(this.dir(id), 'journal.jsonl'), `${JSON.stringify(entry)}\n`);
  }
}

/** A seeded shuffle, so the split is the same every time it is made from the same examples. */
function shuffled<T>(items: readonly T[], seed: number): T[] {
  let state = seed >>> 0 || 1;
  const random = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** Practice, dev and sealed qualification: about 40, 30 and 30 per cent, four of each at least. */
export function splitExamples(
  examples: readonly WspExample[],
  seed: number,
): { practice: WspExample[]; dev: WspExample[]; qualification: WspExample[] } {
  const order = shuffled(examples, seed);
  const qualification = Math.max(4, Math.round(order.length * 0.3));
  const dev = Math.max(4, Math.round(order.length * 0.3));
  return {
    qualification: order.slice(0, qualification),
    dev: order.slice(qualification, qualification + dev),
    practice: order.slice(qualification + dev),
  };
}
