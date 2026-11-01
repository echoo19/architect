import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DatasetExampleSchema,
  FieldExportManifestSchema,
  type DatasetExample,
  type FieldExportManifest,
} from '@architect/shared';
import { assembleDataset, type BuiltDataset } from '../training/dataset';
import { SFT_USES } from './export';

/** A field export that can't be trained on as it stands; the message says why. */
export class ExportDatasetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExportDatasetError';
  }
}

const DEMONSTRATIONS = 'sft/demonstrations.jsonl';
const OFF_THIS_COMPUTER = SFT_USES[1];

/**
 * A field export's demonstrations as a training dataset, for a training job off this computer
 * (decision 101). The file must be the one the export's manifest lists, by hash, and every line
 * must carry the checker's pass and permit training off this computer; the export's own verdict
 * and uses are dropped, leaving each example as the dataset builder wrote it.
 */
export function datasetFromExport(
  exportDir: string,
  now?: () => Date,
): { dataset: BuiltDataset; manifest: FieldExportManifest } {
  const howTo = 'Point --export at a folder written by `architect field export`.';
  const manifestPath = join(exportDir, 'MANIFEST.json');
  if (!existsSync(manifestPath)) {
    throw new ExportDatasetError(`${exportDir} has no MANIFEST.json. ${howTo}`);
  }
  let manifest: FieldExportManifest;
  try {
    manifest = FieldExportManifestSchema.parse(JSON.parse(readFileSync(manifestPath, 'utf8')));
  } catch {
    throw new ExportDatasetError(`${manifestPath} isn't a field export manifest. ${howTo}`);
  }
  const path = join(exportDir, ...DEMONSTRATIONS.split('/'));
  const text = existsSync(path) ? readFileSync(path, 'utf8') : null;
  const listed = manifest.files[DEMONSTRATIONS];
  if (text === null || listed === undefined) {
    throw new ExportDatasetError(`${exportDir} has no ${DEMONSTRATIONS}. ${howTo}`);
  }
  if (createHash('sha256').update(text).digest('hex') !== listed) {
    throw new ExportDatasetError(
      `${DEMONSTRATIONS} doesn't match the hash in ${manifestPath}; it changed after the export.`,
    );
  }
  const examples: DatasetExample[] = text
    .split('\n')
    .filter((line) => line !== '')
    .map((line, index) => {
      const {
        verdict,
        permitted_uses: uses,
        ...example
      } = JSON.parse(line) as {
        verdict?: { pass?: unknown };
        permitted_uses?: unknown;
      };
      if (verdict?.pass !== true || !Array.isArray(uses) || !uses.includes(OFF_THIS_COMPUTER)) {
        throw new ExportDatasetError(
          `Demonstration ${index + 1} has no checker's pass or may not be trained on off this computer.`,
        );
      }
      return DatasetExampleSchema.parse(example);
    });
  if (examples.length === 0) {
    const why = manifest.left_out
      .filter((entry) => /^(demonstration|attempt) /.test(entry.what))
      .map((entry) => entry.why);
    const reasons = [...new Set(why)].slice(0, 3).join('; ');
    throw new ExportDatasetError(
      `The export of ${manifest.job.name} has no demonstrations to train on${reasons === '' ? '' : `: ${reasons}`}.`,
    );
  }
  return {
    dataset: assembleDataset(examples, {
      remoteTrainingAllowed: true,
      excluded: [],
      ...(now === undefined ? {} : { now }),
    }),
    manifest,
  };
}
