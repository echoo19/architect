import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(import.meta.url);

/**
 * The repository's trainer folder: three folders above the bundled command (the app's resources),
 * four above this source file, or wherever ARCHITECT_TRAINER_DIR says.
 */
export function trainerDir(env: NodeJS.ProcessEnv): string {
  const set = env['ARCHITECT_TRAINER_DIR'];
  if (set) return set;
  const up = extname(here) === '.mjs' ? ['..', '..', '..'] : ['..', '..', '..', '..'];
  return join(dirname(here), ...up, 'trainer');
}
