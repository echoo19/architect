import { STUDENT_PRESETS, type MentorConfig, type StudentEndpoint } from '@architect/shared';

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

export function mentorName(mentor: MentorConfig): string {
  return shortModelName(mentor.label);
}

/*
 * How a screen introduces the two models the first time it names them, so the roles read the
 * same everywhere: "Spark, the mentor" and "Glimmer, your agent's model".
 */

export const MENTOR_ROLE = 'the mentor';

/**
 * A kept setup by where it came from rather than its internal number: "the first draft", "the
 * setup from round 4". A setup's number is the round whose change made it.
 */
export function setupName(version: number, firstDraft: boolean): string {
  if (version === 0) return 'the starting setup';
  if (version === 1 && firstDraft) return 'the first draft';
  return `the setup from round ${version}`;
}
export const MENTOR_ROLE_DETAIL = 'a cloud model that coaches during training only';
export const STUDENT_ROLE = "your agent's model";

/** A phrase as it starts a line: "the mentor" → "The mentor". */
export function capitalized(phrase: string): string {
  return phrase.charAt(0).toUpperCase() + phrase.slice(1);
}

export function mentorIntro(name: string): string {
  return `${name}, ${MENTOR_ROLE}`;
}

export function studentIntro(name: string): string {
  return `${name}, ${STUDENT_ROLE}`;
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
