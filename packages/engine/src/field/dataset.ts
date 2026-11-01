import type { FieldExportManifest } from '@architect/shared';
import type { BuiltDataset } from '../training/dataset';
import { buildFieldExport, storedFieldSource } from './export';

/** A field with nothing it may train on off this computer; the message says why. */
export class FieldDatasetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FieldDatasetError';
  }
}

/**
 * What a training job off this computer trains on, for a job in the app's data folder (decision
 * 101): the field export's demonstrations, built here by the exporter itself, from the job's
 * own records, with every guard it has (train material only, the job's sharing setting, the
 * locked test's leak detector, the sealed organizations' names). Nothing a caller wrote is read,
 * so nothing a caller wrote can be sent.
 */
export async function fieldDataset(
  dataDir: string,
  job: string,
  now?: () => Date,
): Promise<{ dataset: BuiltDataset; manifest: FieldExportManifest }> {
  const source = await storedFieldSource(dataDir, job);
  const { dataset, manifest } = buildFieldExport({
    ...source,
    ...(now === undefined ? {} : { now }),
  });
  if (dataset === null || !dataset.manifest.remote_training_allowed) {
    const why = manifest.left_out
      .filter((entry) => /^(demonstration|attempt) /.test(entry.what))
      .map((entry) => entry.why);
    const reasons = [...new Set(why)].slice(0, 3).join('; ');
    throw new FieldDatasetError(
      `${manifest.job.name} has no demonstrations to train on off this computer${reasons === '' ? '' : `: ${reasons}`}.`,
    );
  }
  return { dataset, manifest };
}
