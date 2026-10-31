import type { FieldView, ReportCard } from '@architect/shared';
import type { EngineStore } from '../store/engine-store';
import type { JobRecord } from '../store/records';

/*
 * The versions of a job: a later version is a job of its own, made by teaching on one of the
 * earlier one's never-seen organizations (decision 089) or by carrying it to another model
 * (decision 095), and it records the job it came from and why. Each version has at most one next
 * version, so they read as one line from the first.
 */

/** The version made from this job, or null while it is the newest. */
export function nextVersion(store: EngineStore, jobId: string): JobRecord | null {
  return store.jobs.list().find((record) => record.versionOf?.jobId === jobId) ?? null;
}

/** This job and every version made from it since, oldest first. */
export function laterVersions(store: EngineStore, jobId: string): JobRecord[] {
  const line: JobRecord[] = [];
  const seen = new Set<string>();
  for (let at = store.jobs.get(jobId); at !== null && !seen.has(at.id);) {
    line.push(at);
    seen.add(at.id);
    at = nextVersion(store, at.id);
  }
  return line;
}

/** Every version of the job's field, oldest first, from the first one made. */
export function versionLine(store: EngineStore, jobId: string): JobRecord[] {
  let first = store.jobs.get(jobId);
  const seen = new Set<string>();
  while (first?.versionOf !== undefined && !seen.has(first.id)) {
    seen.add(first.id);
    const earlier = store.jobs.get(first.versionOf.jobId);
    if (earlier === null) break;
    first = earlier;
  }
  return first === null ? [] : laterVersions(store, first.id);
}

/** The newest version of the job: the job itself while nothing was made from it. */
export function newestVersion(store: EngineStore, jobId: string): string {
  return laterVersions(store, jobId).at(-1)?.id ?? jobId;
}

/**
 * The newest version of the job that runs on the same model: an improvement teaches there, and
 * never past a version that moved the field to another model (decision 095).
 */
export function newestOnSameModel(store: EngineStore, jobId: string): string {
  let newest = jobId;
  for (const record of laterVersions(store, jobId).slice(1)) {
    if (record.versionOf?.reason === 'model') break;
    newest = record.id;
  }
  return newest;
}

/**
 * The agent version a version carried to another model started from (decision 095), while its
 * agent is still here: its trainings become versions of that agent. Null for any other job.
 */
export function carriedFrom(
  store: EngineStore,
  jobId: string,
): { graduateId: string; version: number } | null {
  const carried = store.jobs.get(jobId)?.versionOf?.model?.carried;
  if (carried === undefined) return null;
  return store.versions.get(carried.graduateId, carried.version) === null ? null : carried;
}

/**
 * The organizations this job never saw that a later version teaches on, by id, each with the
 * version that first did.
 */
export function taughtLater(store: EngineStore, jobId: string): Map<string, JobRecord> {
  const taught = new Map<string, JobRecord>();
  for (const record of laterVersions(store, jobId).slice(1)) {
    const org = record.versionOf?.org;
    if (org !== undefined && !taught.has(org.id)) taught.set(org.id, record);
  }
  return taught;
}

/**
 * A field's view with its versions: the version it is of, the one made from it, and each sealed
 * organization a later version teaches on, which stays sealed here.
 */
export function withVersions(view: FieldView, store: EngineStore): FieldView {
  const later = [...taughtLater(store, view.jobId).values()];
  const record = store.jobs.get(view.jobId);
  const versionOf = record?.versionOf;
  const from = versionOf === undefined ? null : store.jobs.get(versionOf.jobId);
  const next = nextVersion(store, view.jobId);
  return {
    ...view,
    sealed: view.sealed.map((org) => {
      const into = later.find((version) => version.versionOf?.org?.name === org.name);
      return into === undefined ? org : { ...org, taughtIn: { jobId: into.id, name: into.name } };
    }),
    ...(versionOf === undefined || from === null
      ? {}
      : {
          versionOf: {
            jobId: from.id,
            name: from.name,
            version: versionOf.version,
            ...(versionOf.org === undefined ? {} : { org: versionOf.org.name }),
            ...(versionOf.model === undefined
              ? {}
              : {
                  model: {
                    from: versionOf.model.from.label,
                    to: versionOf.model.to.label,
                    ...(versionOf.model.carried === undefined
                      ? {}
                      : { carried: versionOf.model.carried }),
                  },
                }),
          },
        }),
    ...(next === null
      ? {}
      : {
          nextVersion: {
            jobId: next.id,
            name: next.name,
            ...(next.versionOf?.model === undefined
              ? {}
              : { model: next.versionOf.model.to.label }),
          },
        }),
  };
}

/**
 * A card as it is read once a later version teaches on organizations it measured as never seen:
 * each of their results, and each certificate check there, marked as measured before. Nothing
 * else changes, and the card as filed is never rewritten.
 */
export function labelTaughtLater(
  card: ReportCard,
  taught: ReadonlyMap<string, { createdAt: string }>,
): ReportCard {
  if (taught.size === 0) return card;
  // Only a card filed before the version that teaches on it was made was measured before.
  const before = (org: string | undefined) => {
    const version = org === undefined ? undefined : taught.get(org);
    return version !== undefined && card.createdAt < version.createdAt;
  };
  const marked = <T extends { org?: string; seen: boolean }>(item: T): T =>
    !item.seen && before(item.org) ? { ...item, taughtLater: true as const } : item;
  const { perOrg } = card.test;
  const { certificate } = card;
  return {
    ...card,
    test: { ...card.test, ...(perOrg === undefined ? {} : { perOrg: perOrg.map(marked) }) },
    ...(certificate?.issued === true
      ? { certificate: { ...certificate, checks: certificate.checks.map(marked) } }
      : {}),
  };
}
