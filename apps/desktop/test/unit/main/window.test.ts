import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { resolveWindowState } from '../../../src/main/window/bounds';
import { isAppUrl } from '../../../src/main/security';
import { readLaunchOptions } from '../../../src/main/launch';

const LAPTOP = { x: 0, y: 0, width: 1512, height: 944 };
const SMALL = { x: 0, y: 0, width: 1280, height: 720 };

describe('resolveWindowState', () => {
  it('opens at the default size when nothing was saved', () => {
    expect(resolveWindowState(null, [LAPTOP])).toEqual({
      width: 1440,
      height: 900,
      maximized: false,
    });
  });

  it('fits the default size to a smaller display, but never below the minimum', () => {
    expect(resolveWindowState(null, [SMALL])).toEqual({
      width: 1280,
      height: 720,
      maximized: false,
    });
    expect(resolveWindowState(null, [{ x: 0, y: 0, width: 800, height: 600 }])).toEqual({
      width: 960,
      height: 640,
      maximized: false,
    });
  });

  it('restores a saved position that is still on screen', () => {
    const saved = { x: 100, y: 80, width: 1200, height: 800, maximized: true };
    expect(resolveWindowState(saved, [LAPTOP])).toEqual(saved);
  });

  it('drops a position on a display that is gone', () => {
    const saved = { x: 2400, y: 100, width: 1200, height: 800, maximized: false };
    expect(resolveWindowState(saved, [LAPTOP])).toEqual({
      width: 1200,
      height: 800,
      maximized: false,
    });
  });

  it('keeps a position on a second display', () => {
    const second = { x: 1512, y: 0, width: 1920, height: 1080 };
    const saved = { x: 1600, y: 50, width: 1400, height: 900, maximized: false };
    expect(resolveWindowState(saved, [LAPTOP, second])).toEqual(saved);
  });
});

describe('isAppUrl', () => {
  const indexFile = join(tmpdir(), 'Architect', 'out', 'renderer', 'index.html');
  const indexUrl = pathToFileURL(indexFile).href;
  const built = { indexFile };

  it('accepts the built page with any hash route', () => {
    expect(isAppUrl(indexUrl, built)).toBe(true);
    expect(isAppUrl(`${indexUrl}#/runs/r1/train`, built)).toBe(true);
  });

  it('rejects other files and other origins', () => {
    expect(isAppUrl(pathToFileURL(join(tmpdir(), 'other.html')).href, built)).toBe(false);
    expect(isAppUrl('https://example.com/', built)).toBe(false);
    expect(isAppUrl('not a url', built)).toBe(false);
  });

  it('accepts only the dev server origin in development', () => {
    const dev = { ...built, devServerUrl: 'http://localhost:5173' };
    expect(isAppUrl('http://localhost:5173/#/new', dev)).toBe(true);
    expect(isAppUrl('http://localhost:5174/', dev)).toBe(false);
    expect(isAppUrl(indexUrl, dev)).toBe(false);
  });
});

describe('readLaunchOptions', () => {
  it('reads the hidden flag, the profile folder and the dev server', () => {
    expect(readLaunchOptions({})).toEqual({ hidden: false });
    expect(
      readLaunchOptions({
        ARCHITECT_HIDDEN: '1',
        ARCHITECT_USER_DATA: '/tmp/profile',
        ELECTRON_RENDERER_URL: 'http://localhost:5173',
      }),
    ).toEqual({ hidden: true, userDataDir: '/tmp/profile', devServerUrl: 'http://localhost:5173' });
  });
});
