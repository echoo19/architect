import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * The app's data folder, found the way the desktop app finds it: ARCHITECT_USER_DATA when set,
 * else Electron's `userData` folder for an app called Architect. The architect command works on
 * it, and a tool with a data folder of its own takes its turns at the GPU there (decision 046).
 */
export function appDataDir(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
  home: string = homedir(),
): string {
  const override = env['ARCHITECT_USER_DATA'];
  if (override) return resolve(override);
  if (platform === 'win32') {
    return join(env['APPDATA'] || join(home, 'AppData', 'Roaming'), 'Architect');
  }
  if (platform === 'darwin') return join(home, 'Library', 'Application Support', 'Architect');
  return join(env['XDG_CONFIG_HOME'] || join(home, '.config'), 'Architect');
}
