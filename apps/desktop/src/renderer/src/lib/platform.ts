export type Platform = 'darwin' | 'win32' | 'linux';

/** Reads the platform from the user agent, which is available synchronously at startup. */
export function detectPlatform(userAgent: string): Platform {
  if (/Macintosh|Mac OS X/i.test(userAgent)) return 'darwin';
  if (/Windows/i.test(userAgent)) return 'win32';
  return 'linux';
}

/** How the app refers to the user's machine: "This Mac" on macOS, "This computer" elsewhere. */
export function deviceLabel(platform: Platform): string {
  return platform === 'darwin' ? 'This Mac' : 'This computer';
}

/** The same name mid-sentence: "runs on this Mac". */
export function deviceInSentence(platform: Platform): string {
  return platform === 'darwin' ? 'this Mac' : 'this computer';
}

let cached: Platform | undefined;

export function currentPlatform(): Platform {
  cached ??= detectPlatform(navigator.userAgent);
  return cached;
}

export function isMac(): boolean {
  return currentPlatform() === 'darwin';
}
