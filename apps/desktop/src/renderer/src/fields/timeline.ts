import {
  bestCandidate,
  reportScores,
  type Certificate,
  type Certification,
  type Counterexample,
  type ExperimentRecord,
  type OrgScores,
  type Qualification,
  type Run,
  type StudyState,
} from '@architect/shared';
import { formatPercent, shortPath } from '../lib/format';
import { paths } from '../lib/router';
import { STATUS_WORDS } from '../experiments/model';
import { boundPercent } from '../flow/report/certificate-words';
import type { Candidate, FieldSummary } from './model';
import { plural } from './parts';

/*
 * A field's life as one timeline (decision 091): the version it was made from and any later one,
 * by teaching on an organization (decision 089) or moving to another model (decision 094), what
 * it was studied from, each training, each final test, each certificate, each experiment and this session's export, every entry read from
 * a stored record and linked to the place that holds it. A stage with no record has no entry; one
 * next step, worked out from what is missing, closes the line.
 */

export type Stage =
  'learned' | 'moved' | 'studied' | 'taught' | 'tested' | 'certified' | 'compared' | 'exported';

/** Where an entry leads: a place of the app, or a tab of the field's own page. */
export interface Link {
  place: string;
  to: { path: string } | { tab: 'organizations' | 'assets' };
}

export interface TimelineEntry {
  key: string;
  stage: Stage;
  /** The stage as the row names it, when it says more than its word: "Moved to Qwen3 8B". */
  word?: string;
  at: string;
  sentence: string;
  link: Link;
}

export interface NextStep {
  sentence: string;
  link: Link;
}

/** A version an agent holds, as Models lists it: its row's key and "Academy desk v2". */
export interface HeldVersion {
  key: string;
  name: string;
  runId: string;
}

/**
 * A later version, and when it was made: by teaching on an organization this field never saw, or
 * by moving the field to another model.
 */
export type LaterVersion = { jobId: string; name: string; at: string } & (
  { org: string } | { model: string }
);

/** The records the timeline reads beside the field's own. */
export interface TimelineRecords {
  study: StudyState | undefined;
  counterexamples: readonly Counterexample[];
  versions: readonly HeldVersion[];
  /** Certifications after the fact of the field's versions. */
  certifications: readonly Certification[];
  /** Models trained elsewhere and qualified on the field (decision 086). */
  qualifications: readonly Qualification[];
  experiments: readonly ExperimentRecord[];
  /** Later versions taught on one of the field's never-seen organizations or moved to a model. */
  laterVersions: readonly LaterVersion[];
  /** The field's latest export written in this session; exports aren't kept in the library. */
  exported: { dir: string; at: string } | undefined;
}

export const STAGE_WORDS: Record<Stage, string> = {
  learned: 'Learned from',
  moved: 'Moved to',
  studied: 'Studied',
  taught: 'Taught',
  tested: 'Tested',
  certified: 'Certified',
  compared: 'Compared',
  exported: 'Exported',
};

const STAGE_ORDER: Stage[] = [
  'learned',
  'moved',
  'studied',
  'taught',
  'tested',
  'certified',
  'compared',
  'exported',
];

/** "a, b and c". */
function list(parts: readonly string[]): string {
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
}

/** "92% taught on, 83% never seen and 90% real", each kind only where it was measured. */
function scoresPhrase(scores: OrgScores): string {
  const parts = [
    scores.seen && `${formatPercent(scores.seen)} taught on`,
    scores.unseen && `${formatPercent(scores.unseen)} never seen`,
    scores.real && `${formatPercent(scores.real)} real`,
  ].filter((part): part is string => typeof part === 'string');
  return list(parts);
}

function taughtHead(run: Run): string {
  const rounds = plural(run.totals.rounds, 'round');
  switch (run.status) {
    case 'queued':
      return 'Training is queued';
    case 'running':
    case 'stopping':
      return `Training, ${rounds} so far`;
    case 'paused':
      return `Training paused after ${rounds}`;
    case 'testing':
      return `Trained ${rounds}, taking its final test`;
    case 'stopped':
      return `Training stopped after ${rounds}`;
    case 'failed':
      return `Training failed after ${rounds}`;
    case 'finished':
      return `Trained ${rounds}`;
  }
}

const ACTIVE: ReadonlySet<Run['status']> = new Set([
  'queued',
  'running',
  'paused',
  'stopping',
  'testing',
]);

const NO_CERTIFICATE: Record<Extract<Certificate, { issued: false }>['reason'], string> = {
  none_answered: 'its attempts never agreed enough to answer',
  error_rate: 'it was wrong too often',
  too_few: 'too few calibration tasks',
};

/** One certificate in a sentence, with whether it held where the version was never taught. */
function certificateSentence(name: string, certificate: Certificate): string {
  if (!certificate.issued) return `${name} wasn't certified: ${NO_CERTIFICATE[certificate.reason]}`;
  const claim = `${name} was certified: wrong on at most ${boundPercent(certificate.threshold.bound)}% of the answers it gives`;
  const unseen = certificate.checks.filter((check) => !check.seen);
  if (unseen.length === 0) return claim;
  const held = unseen.filter((check) => check.held).length;
  return `${claim}, and it held on ${held} of the ${plural(unseen.length, 'organization')} it never saw`;
}

/** Every entry of the field's life, oldest first, and the one next step its records leave. */
export function fieldTimeline(
  field: Pick<FieldSummary, 'job' | 'view' | 'runs' | 'candidates'>,
  records: TimelineRecords,
): { entries: TimelineEntry[]; next: NextStep | null } {
  const jobId = field.job.id;
  const entries: TimelineEntry[] = [];
  const held = (runId: string) => records.versions.find((version) => version.runId === runId);
  const candidateOf = (runId: string) =>
    field.candidates.find((candidate) => candidate.run.id === runId);
  const nameOf = (runId: string) => {
    const run = field.runs.find((item) => item.id === runId);
    return held(runId)?.name ?? (run ? `Harness v${run.currentVersion}` : 'A version');
  };
  const results = (runId: string): Link => ({
    place: 'Results',
    to: { path: paths.report(runId) },
  });
  const versionLink = (runId: string): Link => {
    const version = held(runId);
    return version ? { place: 'Models', to: { path: paths.models(version.key) } } : results(runId);
  };

  const versionOf = field.view.versionOf;
  if (versionOf?.model) {
    entries.push({
      key: `moved:${versionOf.jobId}`,
      stage: 'moved',
      word: `Moved to ${versionOf.model.to}`,
      at: field.job.createdAt,
      sentence: `Made as version ${versionOf.version} from ${versionOf.name}, carried from ${versionOf.model.from} to ${versionOf.model.to} with its harness, lessons and tasks`,
      link: { place: 'Field', to: { path: paths.field(versionOf.jobId) } },
    });
  } else if (versionOf?.org) {
    entries.push({
      key: `learned:${versionOf.jobId}`,
      stage: 'learned',
      at: field.job.createdAt,
      sentence: `Made as version ${versionOf.version} from ${versionOf.name} by teaching on ${versionOf.org}, which it had never seen`,
      link: { place: 'Field', to: { path: paths.field(versionOf.jobId) } },
    });
  }

  for (const later of records.laterVersions) {
    const link: Link = { place: 'Field', to: { path: paths.field(later.jobId) } };
    entries.push(
      'model' in later
        ? {
            key: `moved:${later.jobId}`,
            stage: 'moved',
            word: `Moved to ${later.model}`,
            at: later.at,
            sentence: `${later.name}, a later version, was carried to ${later.model}`,
            link,
          }
        : {
            key: `learned:${later.jobId}:${later.org}`,
            stage: 'learned',
            at: later.at,
            sentence: `${later.name}, a later version, was taught on ${later.org}, which this one never saw`,
            link,
          },
    );
  }

  const study = records.study;
  if (study?.confirmedAt) {
    const brief = study.brief;
    entries.push({
      key: 'study',
      stage: 'studied',
      at: study.confirmedAt,
      sentence: brief
        ? `You confirmed the study of ${plural(brief.organizations.length, 'organization')}: ${list([plural(brief.skills.length, 'skill'), plural(brief.rules.length, 'rule')])}`
        : 'You confirmed the study brief',
      link: { place: 'Study', to: { path: paths.define(jobId) } },
    });
  }

  for (const run of field.runs) {
    const candidate = candidateOf(run.id);
    const kept = candidate
      ? candidate.report.dev.curve.filter((point) => point.decision === 'kept').length
      : null;
    const found = records.counterexamples.filter((item) => item.runId === run.id).length;
    const parts = [
      taughtHead(run),
      ...(kept === null ? [] : [`kept ${plural(kept, 'change')}`]),
      ...(found === 0 ? [] : [`found ${plural(found, 'counterexample')}`]),
    ];
    entries.push({
      key: `taught:${run.id}`,
      stage: 'taught',
      at: ACTIVE.has(run.status) ? run.createdAt : (run.endedAt ?? run.updatedAt),
      sentence: list(parts),
      link: candidate ? results(run.id) : { place: 'Training', to: { path: paths.train(run.id) } },
    });
    if (!candidate) continue;
    const { report } = candidate;
    entries.push({
      key: `tested:${run.id}`,
      stage: 'tested',
      at: report.createdAt,
      sentence: `${nameOf(run.id)} took its final test: ${scoresPhrase(candidate.scores)}`,
      link: results(run.id),
    });
    if (report.certificate) {
      entries.push({
        key: `certified:${run.id}`,
        stage: 'certified',
        at: report.createdAt,
        sentence: certificateSentence(nameOf(run.id), report.certificate),
        link: versionLink(run.id),
      });
    }
  }

  for (const item of field.view.qualifications ?? []) {
    if (item.status !== 'finished' || !item.score) continue;
    entries.push({
      key: `added:${item.runId}:${item.org}`,
      stage: 'tested',
      at: item.endedAt ?? item.startedAt,
      sentence: `${nameOf(item.runId)} was tested on ${item.org}, added later and never seen: ${formatPercent(item.score)}`,
      link: { place: 'Organizations', to: { tab: 'organizations' } },
    });
  }

  for (const item of records.qualifications) {
    if (item.status !== 'finished' || !item.card) continue;
    entries.push({
      key: `qualified:${item.id}`,
      stage: 'tested',
      at: item.endedAt ?? item.startedAt,
      sentence: `${item.model}, trained elsewhere, took the final test with harness v${item.harnessVersion}: ${scoresPhrase(reportScores(item.card))}`,
      link: { place: 'Compute', to: { path: paths.compute({ jobId }) } },
    });
  }

  for (const item of records.certifications) {
    if (item.status !== 'finished' || !item.certificate) continue;
    entries.push({
      key: `certification:${item.id}`,
      stage: 'certified',
      at: item.endedAt ?? item.createdAt,
      sentence: certificateSentence(nameOf(item.runId), item.certificate),
      link: versionLink(item.runId),
    });
  }

  for (const item of records.experiments) {
    const arms = plural(item.input.arms.length, 'arm');
    const name = item.input.name;
    entries.push({
      key: `experiment:${item.id}`,
      stage: 'compared',
      at: item.createdAt,
      sentence:
        item.status === 'finished'
          ? `Compared ${arms} in “${name}”`
          : item.status === 'running'
            ? `Comparing ${arms} in “${name}”`
            : `“${name}”, ${arms}: ${STATUS_WORDS[item.status].toLowerCase()}`,
      link: { place: 'Experiments', to: { path: paths.experiment(item.id) } },
    });
  }

  if (records.exported) {
    entries.push({
      key: 'exported',
      stage: 'exported',
      at: records.exported.at,
      sentence: `Exported the field's training examples to ${shortPath(records.exported.dir)}`,
      link: { place: 'Compute', to: { path: paths.compute({ jobId }) } },
    });
  }

  entries.sort((a, b) =>
    a.at === b.at
      ? STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage)
      : a.at < b.at
        ? -1
        : 1,
  );
  return { entries, next: nextStep(field, records) };
}

/** The first thing the field's records lack, in the order the flow goes, or nothing. */
function nextStep(
  field: Pick<FieldSummary, 'job' | 'view' | 'runs' | 'candidates'>,
  records: TimelineRecords,
): NextStep | null {
  const jobId = field.job.id;
  const define: Link = { place: 'Study', to: { path: paths.define(jobId) } };
  if (records.study && records.study.state !== 'confirmed') {
    return { sentence: 'Confirm the study brief', link: define };
  }
  if (field.runs.length === 0) {
    return { sentence: 'Start the first training', link: { ...define, place: 'Edit field' } };
  }
  const best: Candidate | null = bestCandidate(field.candidates);
  if (!best) {
    if (field.runs.some((run) => ACTIVE.has(run.status))) return null;
    return {
      sentence: 'Train a version through its final test',
      link: { ...define, place: 'Edit field' },
    };
  }
  if (field.view.sealed.length === 0) {
    return {
      sentence: 'Add an organization it never saw',
      link: { place: 'Organizations', to: { tab: 'organizations' } },
    };
  }
  const certified =
    best.report.certificate?.issued === true ||
    records.certifications.some(
      (item) => item.runId === best.run.id && item.certificate?.issued === true,
    );
  if (!certified) {
    const version = records.versions.find((item) => item.runId === best.run.id);
    return {
      sentence: 'Certify the best version',
      link: version
        ? { place: 'Models', to: { path: paths.models(version.key) } }
        : { place: 'Results', to: { path: paths.report(best.run.id) } },
    };
  }
  if (records.experiments.length === 0) {
    return {
      sentence: 'Compare ways of teaching it in an experiment',
      link: { place: 'Experiments', to: { path: paths.newExperiment(jobId) } },
    };
  }
  return null;
}
