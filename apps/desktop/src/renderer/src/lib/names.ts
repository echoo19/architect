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
