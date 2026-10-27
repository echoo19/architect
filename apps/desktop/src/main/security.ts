import { pathToFileURL } from 'node:url';
import type { Session, WebContents } from 'electron';

/** Where the renderer is served from: the dev server in development, the built file otherwise. */
export interface AppOrigin {
  devServerUrl?: string;
  indexFile: string;
}

/** True only for the app's own page, in any of its hash routes. */
export function isAppUrl(url: string, origin: AppOrigin): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (origin.devServerUrl) {
    return parsed.origin === new URL(origin.devServerUrl).origin;
  }
  const index = pathToFileURL(origin.indexFile);
  return parsed.protocol === 'file:' && parsed.pathname === index.pathname;
}

/** The only permission the renderer gets: writing to the clipboard for copy buttons. */
const ALLOWED_PERMISSIONS = new Set(['clipboard-sanitized-write']);

export function hardenSession(session: Session): void {
  session.setPermissionRequestHandler((_contents, permission, callback) => {
    callback(ALLOWED_PERMISSIONS.has(permission));
  });
  session.setPermissionCheckHandler((_contents, permission) => ALLOWED_PERMISSIONS.has(permission));
}

/** No navigation away from the app, no new windows, no embedded web views. */
export function hardenContents(contents: WebContents, origin: AppOrigin): void {
  const blockForeign = (event: { preventDefault(): void }, url: string) => {
    if (!isAppUrl(url, origin)) event.preventDefault();
  };
  contents.on('will-navigate', blockForeign);
  contents.on('will-redirect', blockForeign);
  contents.on('will-attach-webview', (event) => event.preventDefault());
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
}
