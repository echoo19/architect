import { PROVIDERS, type ProviderId } from '@architect/shared';

/** Opens a web address in the system browser: Electron's `shell.openExternal` in the app. */
export type OpenExternal = (url: string) => Promise<void>;

/** OpenRouter's sign-in page, which the PKCE flow opens. */
const SIGN_IN_HOSTS = ['openrouter.ai'];

/** Hugging Face: its token page, and the repositories agents are published to. */
export const HUGGING_FACE_HOST = 'huggingface.co';

/**
 * The hosts of every page Architect may open: provider key pages, runtime downloads, sign-in,
 * and Hugging Face.
 */
const KNOWN_HOSTS = new Set([
  ...Object.values(PROVIDERS).flatMap((provider) =>
    provider.page ? [new URL(provider.page).hostname] : [],
  ),
  ...SIGN_IN_HOSTS,
  HUGGING_FACE_HOST,
]);

/** Whether Architect may open `url` in the browser: HTTPS, on one of the hosts it knows. */
export function isKnownPage(url: string): boolean {
  if (!URL.canParse(url)) return false;
  const parsed = new URL(url);
  return parsed.protocol === 'https:' && parsed.username === '' && KNOWN_HOSTS.has(parsed.hostname);
}

/** Where to make a provider's key, or where to get a local runtime. */
export function providerPage(provider: ProviderId): string {
  const { page, label } = PROVIDERS[provider];
  if (!page) throw new Error(`${label} has no page to open.`);
  return page;
}

/**
 * The one route to the browser. It opens only pages Architect knows, and nothing at all when
 * the app runs hidden for tests, so no test can pop a browser window on the computer it runs on.
 */
export function createLinkOpener(open: OpenExternal, hidden: boolean): OpenExternal {
  return async (url) => {
    if (!isKnownPage(url)) {
      throw new Error('Architect only opens pages on the sites it knows, over HTTPS.');
    }
    if (hidden) {
      console.warn(`[links] Running hidden, so ${new URL(url).host} was not opened.`);
      return;
    }
    await open(url);
  };
}
