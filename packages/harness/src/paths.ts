import { posix } from 'node:path';
import {
  GuardError,
  INSTRUCTIONS_FILE,
  isHarnessSurfacePath,
  skillFilePath,
} from '@architect/shared';

export const META_PATH = 'harness.yaml';
export const INSTRUCTIONS_PATH = INSTRUCTIONS_FILE;
export const RETRIEVAL_PATH = 'retrieval.yaml';
export const DECODING_PATH = 'decoding.yaml';
export const GUARDRAILS_PATH = 'guardrails.yaml';

export const SKILLS_DIR = 'skills';
export const TOOLS_DIR = 'tools';
export const EXAMPLES_DIR = 'examples';

/** Format 1 kept the instructions here. A format 1 folder is read as if this were AGENTS.md. */
export const LEGACY_SYSTEM_PATH = 'system.md';
/** Format 1 kept each skill in one file, `skills/<slug>.md`. */
export const LEGACY_SKILL = /^skills\/([^/]+)\.md$/;

export const skillPath = skillFilePath;
export const toolManifestPath = (name: string): string => `${TOOLS_DIR}/${name}.json`;
export const toolCodePath = (name: string): string => `${TOOLS_DIR}/${name}.js`;
export const examplePath = (slug: string): string => `${EXAMPLES_DIR}/${slug}.json`;

/** The folders a harness keeps files in, and the top-level files that make up the rest. */
export const HARNESS_DIRS = [SKILLS_DIR, TOOLS_DIR, EXAMPLES_DIR] as const;
export const HARNESS_ROOT_FILES = [
  META_PATH,
  INSTRUCTIONS_PATH,
  LEGACY_SYSTEM_PATH,
  RETRIEVAL_PATH,
  DECODING_PATH,
  GUARDRAILS_PATH,
] as const;

/** Windows treats these as devices whatever the extension, so a file with one of them cannot be written. */
const WINDOWS_DEVICE_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/;

export function fileStem(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot === -1 ? name : name.slice(0, dot);
}

/** The name a file is known by: a skill's folder, or the file name without its extension. */
export function itemName(path: string): string {
  const parts = path.split('/');
  return parts[0] === SKILLS_DIR && parts.length === 3 ? (parts[1] ?? '') : fileStem(path);
}

/** Why a path inside the harness surface still cannot be used, or undefined when it is fine. */
export function reservedNameProblem(path: string): string | undefined {
  if (path.includes('/') && WINDOWS_DEVICE_NAME.test(itemName(path))) {
    return `${path}: "${itemName(path)}" is a name Windows reserves for devices, so pick a different name`;
  }
  return undefined;
}

/**
 * Turns a path from an edit into the canonical harness path, or throws a `harness_surface`
 * GuardError. Anything that could reach outside the harness folder or touch a file the mentor
 * does not own is refused rather than corrected. The format 1 names of the instructions and of
 * a skill are refused with the name to use instead.
 */
export function normalizeEditPath(raw: string): string {
  const refuse = (reason: string): never => {
    throw new GuardError('harness_surface', `Edit refused: "${raw}" ${reason}.`);
  };

  if (raw.includes('\0')) refuse('contains a null character');
  if (raw.includes('\\')) refuse('uses a backslash; paths use forward slashes');
  if (raw.startsWith('/') || /^[A-Za-z]:/.test(raw)) refuse('is an absolute path');
  if (raw.split('/').includes('..')) refuse('climbs out of the harness folder with ".."');

  const path = posix.normalize(raw);
  if (path === META_PATH) refuse('is managed by Architect and cannot be edited');
  if (path === LEGACY_SYSTEM_PATH) refuse(`is an old name: the instructions live in AGENTS.md`);
  const legacySkill = LEGACY_SKILL.exec(path);
  if (legacySkill) {
    refuse(`is an old name: a skill is a folder, so write ${skillPath(legacySkill[1] ?? '')}`);
  }
  if (!isHarnessSurfacePath(path)) refuse('is outside the harness surface');
  if (reservedNameProblem(path)) refuse('uses a name Windows reserves for devices');
  return path;
}

/** True for a path that belongs to a harness folder, whether or not its name is valid. */
export function belongsToHarness(path: string): boolean {
  return (
    HARNESS_ROOT_FILES.some((file) => file === path) ||
    HARNESS_DIRS.some((dir) => path.startsWith(`${dir}/`))
  );
}
