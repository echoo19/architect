import type {
  GraduateManifest,
  GraduateVersion,
  Installation,
  ModelBinding,
} from '@architect/shared';
import { INSTALL_CHECKS_LABEL } from '@architect/shared';
import type { DataPaths } from '../loop/paths';
import type { StoredChecks, StoredInstallation, StoredVersion } from '../store/records';
import { absoluteBindings } from './bindings';

/**
 * The format 1 shape the workspace's screens read, made from a version's package and this
 * computer's model binding. The package says what the graduate is; only the endpoint is local.
 */
export function workspaceView(version: StoredVersion, model: ModelBinding): GraduateManifest {
  const { manifest } = version;
  const { evidence, harness } = manifest;
  const provenance = evidence.provenance;
  const summary = evidence.summary;
  return {
    format: 1,
    id: version.graduateId,
    name: manifest.identity.name,
    jobId: manifest.contract.jobId,
    runId: version.runId ?? provenance?.runId ?? '',
    method: manifest.identity.method,
    createdAt: manifest.identity.createdAt,
    ...(version.acceptedAt === undefined ? {} : { acceptedAt: version.acceptedAt }),
    student: {
      label: manifest.model.label,
      runtime: model.runtime,
      baseUrl: model.baseUrl,
      model: model.model,
      ...(manifest.model.base.quantization === undefined
        ? {}
        : { quantization: manifest.model.base.quantization }),
      ...(manifest.model.base.digest === undefined ? {} : { digest: manifest.model.base.digest }),
      ...(manifest.model.base.sizeBytes === undefined
        ? {}
        : { sizeBytes: manifest.model.base.sizeBytes }),
      contextLength: manifest.model.inference.contextLength,
    },
    harness: {
      version: harness.version,
      hash: harness.hash,
      ...(harness.round === undefined ? {} : { round: harness.round }),
      ...(harness.draft === undefined ? {} : { draft: harness.draft }),
    },
    requirements: summary
      ? {
          passRate: summary.passRate,
          ...(summary.p95LatencyMs === undefined ? {} : { p95LatencyMs: summary.p95LatencyMs }),
        }
      : {
          passRate: { target: manifest.contract.acceptance.passRate, actual: 0, met: false },
        },
    test: {
      score: summary?.score ?? { pass: 0, total: 0 },
      perType: summary?.perType ?? [],
      ...(provenance === undefined ? {} : { testedOn: provenance.testedOn }),
    },
    mentor: provenance?.mentor ?? { label: 'No mentor', model: '' },
  };
}

export function versionInfo(
  paths: DataPaths,
  version: StoredVersion,
  activeVersion: number | null,
): GraduateVersion {
  return {
    graduateId: version.graduateId,
    version: version.version,
    ...(version.parent === undefined ? {} : { parent: version.parent }),
    ...(version.origin === undefined ? {} : { origin: version.origin }),
    state: version.state,
    active: version.version === activeVersion,
    evaluation: version.evaluation,
    contractVersion: version.contractVersion,
    digest: version.digest,
    ...(version.runId === undefined ? {} : { runId: version.runId }),
    path: paths.fromStored(version.path),
    manifest: version.manifest,
    createdAt: version.createdAt,
    ...(version.acceptedAt === undefined ? {} : { acceptedAt: version.acceptedAt }),
  };
}

/** The installation as the app shows it: this computer's bindings and the version's last checks. */
export function installationView(
  paths: DataPaths,
  installation: StoredInstallation,
  version: number,
  checks: StoredChecks | null,
): Installation {
  return {
    graduateId: installation.graduateId,
    version,
    label: INSTALL_CHECKS_LABEL,
    model: installation.model,
    bindings: absoluteBindings(paths, installation.bindings),
    grants: installation.grants,
    status: checks?.status ?? 'unchecked',
    reasons: checks?.reasons ?? [],
    checks: checks?.checks ?? [],
    ...(checks?.machine === undefined ? {} : { machine: checks.machine }),
    measurements: checks?.measurements ?? {},
    ...(checks === null ? {} : { checkedAt: checks.checkedAt }),
  };
}
