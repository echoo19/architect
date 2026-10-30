import { existsSync, readdirSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  ModelConfigRead,
  ModelConfigSource,
  TrainBundleRequest,
  TrainingPlan,
  TrainingPlanRequest,
  WrittenTrainBundle,
} from '@architect/shared';
import type { HubClient } from '../hub';
import { BundleError, writeTrainBundle } from './bundle';
import { fetchModelConfig, MAX_CONFIG_BYTES, parseModelConfig } from './config';
import { planTraining } from './plan';
import { SizingError } from './size';

/*
 * The app's Compute place, over the same functions `architect train` uses: read a config, size a
 * plan from it, write a bundle. Setup only; a graduate never calls any of them.
 */

/** A model's config.json from the Hub at a revision (resolved to its commit), or from a file. */
export async function readModelConfig(
  hub: HubClient,
  source: ModelConfigSource,
): Promise<ModelConfigRead> {
  if (source.kind === 'hub') {
    const { config, revision } = await fetchModelConfig(hub, source.repo, source.revision);
    return { config, model: { repo: source.repo, revision } };
  }
  if (!existsSync(source.path) || statSync(source.path).size > MAX_CONFIG_BYTES) {
    throw new SizingError(`${source.path} isn't a config.json Architect can read.`);
  }
  const text = await readFile(source.path, 'utf8');
  return { config: parseModelConfig(text, source.path), model: { repo: null, revision: null } };
}

export function planFromRequest(request: TrainingPlanRequest): TrainingPlan {
  const { config, model, ...input } = request;
  return planTraining(config, { model, ...input });
}

/** A folder inside `parent` that doesn't exist yet or is empty: `<model>-<target>`, then `-2`. */
function freshFolder(parent: string, base: string): string {
  for (let n = 1; ; n += 1) {
    const dir = join(parent, n === 1 ? base : `${base}-${n}`);
    if (!existsSync(dir) || readdirSync(dir).length === 0) return dir;
  }
}

/** Sizes the plan again and writes its bundle in a new folder inside the one chosen. */
export function bundleFromRequest(
  request: TrainBundleRequest,
  trainerDir: string | undefined,
): WrittenTrainBundle {
  if (trainerDir === undefined) {
    throw new BundleError(
      "This copy of Architect has no trainer folder, so it can't write bundles.",
    );
  }
  const plan = planFromRequest(request.plan);
  const name = plan.model.repo?.split('/')[1] ?? 'model';
  return writeTrainBundle({
    target: request.target,
    plan,
    trainerDir,
    exportDir: request.exportDir,
    outputDir: freshFolder(request.parentDir, `${name}-${request.target}`),
  });
}
