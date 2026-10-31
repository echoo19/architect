import {
  DEFAULT_STUDENT,
  GLIMMER_BUILDS,
  STUDENT_PRESETS,
  isLoopbackUrl,
  type MentorConfig,
  type StudentEndpoint,
} from '@architect/shared';

/**
 * The short name the UI uses for a model: "Muse Spark 1.3" → "Spark",
 * "Muse Glimmer on this computer" → "Glimmer", "Muse Spark Open on Baseten" → "Spark Open".
 */
export function shortModelName(label: string): string {
  const short = label
    .replace(/,.*$/, '')
    .replace(/\s+on\s+.*$/i, '')
    .replace(/^Muse\s+/i, '')
    .replace(/\s+v?\d+(\.\d+)*$/i, '')
    .trim();
  return short || label;
}

/** How many letters the two models' names may have together beside an inspector's other tabs. */
const TAB_NAMES_MAX = 12;

/**
 * Whether an inspector's teacher and student tabs fit by their models' short names ("Spark" and
 * "Glimmer" do). Longer ones ("Qwen3 235B") would cut every tab, so those two show their icons,
 * named by the model, and the panel under each names it too.
 */
export function modelTabsFit(names: { mentor: string; student: string }): boolean {
  return names.mentor.length + names.student.length <= TAB_NAMES_MAX;
}

export function mentorName(mentor: MentorConfig): string {
  return shortModelName(mentor.label);
}

/**
 * The mentor runs on this computer: a model at an address on this machine, whatever runtime
 * serves it. A runtime that is local by kind but is pointed at another machine's address is
 * online, and so is a coding agent, so this is the one answer to "does the teacher leave this
 * computer" for every screen that says so.
 */
export function mentorIsLocal(mentor: MentorConfig): boolean {
  return mentor.kind === 'model' && isLoopbackUrl(mentor.baseUrl);
}

/**
 * A kept setup by where it came from rather than its internal number: "the first draft", "the
 * setup from round 4", or "the starting setup" when no round made it.
 */
export function setupName(origin: {
  round?: number | undefined;
  draft?: boolean | undefined;
}): string {
  if (origin.draft) return 'the first draft';
  if (origin.round !== undefined) return `the setup from round ${origin.round}`;
  return 'the starting setup';
}

/**
 * The version an agent answers with, as the Teaching tab names it: "Version 2". A graduate from
 * before versions has none, so its setup is named by where it came from.
 */
export function activeVersionName(agent: {
  activeVersion: number | null;
  manifest: { harness: { round?: number | undefined; draft?: boolean | undefined } };
}): string {
  return agent.activeVersion === null
    ? capitalized(setupName(agent.manifest.harness))
    : `Version ${agent.activeVersion}`;
}

/** What the model an agent runs on is called where a setting names it. */
export const STUDENT_ROLE = "your agent's model";

/** A phrase as it starts a line: "the mentor" → "The mentor". */
export function capitalized(phrase: string): string {
  return phrase.charAt(0).toUpperCase() + phrase.slice(1);
}

/**
 * The model an agent runs on here, as its status line names it: "Glimmer" for one of Glimmer's
 * builds, and the model's own id for any other, so a model chosen in its settings is never shown
 * as the one it was trained on.
 */
export function agentModelName(student: { label: string; model: string }): string {
  const build = GLIMMER_BUILDS.find((candidate) => candidate.model === student.model);
  return build ? shortModelName(student.label) : student.model;
}

/** An installed agent's base model: "Glimmer" for one of Glimmer's builds, its own id for any other. */
export function baseModelName(model: string): string {
  return GLIMMER_BUILDS.some((build) => build.model === model) ? DEFAULT_STUDENT.label : model;
}

/** How the UI writes a quantization: "Q4_K_M" → "4-bit". Unknown schemes stay as they are. */
export function quantizationLabel(quantization: string): string {
  const bits = /^(?:Q|IQ)(\d)(?:_|$)/i.exec(quantization)?.[1];
  if (bits) return `${bits}-bit`;
  if (/^(?:F|BF)16$/i.test(quantization)) return '16-bit';
  return quantization;
}

/** The student's display label, from the matching preset when there is one. */
export function studentLabel(student: StudentEndpoint): string {
  const preset = STUDENT_PRESETS.find(
    (p) => p.model === student.model && p.runtime === student.runtime,
  );
  return preset ? preset.label.replace(/\s+on\s+.*$/i, '') : student.model;
}

export function studentName(student: StudentEndpoint): string {
  return shortModelName(studentLabel(student));
}
