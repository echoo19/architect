/** Launch switches read from the environment. */
export interface LaunchOptions {
  /** Create windows hidden (tests and screenshots). Set with ARCHITECT_HIDDEN=1. */
  hidden: boolean;
  /** A separate profile folder, e.g. for tests. Set with ARCHITECT_USER_DATA. */
  userDataDir?: string;
  /** The renderer dev server, set by electron-vite in development. */
  devServerUrl?: string;
}

export function readLaunchOptions(env: NodeJS.ProcessEnv): LaunchOptions {
  const options: LaunchOptions = { hidden: env.ARCHITECT_HIDDEN === '1' };
  if (env.ARCHITECT_USER_DATA) options.userDataDir = env.ARCHITECT_USER_DATA;
  if (env.ELECTRON_RENDERER_URL) options.devServerUrl = env.ELECTRON_RENDERER_URL;
  return options;
}
