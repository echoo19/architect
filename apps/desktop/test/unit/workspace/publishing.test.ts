import type { PublishProgress } from '@architect/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  IDLE,
  lastTarget,
  startPublishing,
  usePublishing,
} from '../../../src/renderer/src/workspace/settings/publishing';

const TARGET = { repository: 'jake/desk', version: 2, visibility: 'private' as const };

function uploading(sentBytes: number, graduateId = 'grd_1'): PublishProgress {
  return {
    graduateId,
    version: 2,
    repository: 'jake/desk',
    stage: 'uploading',
    sentBytes,
    totalBytes: 100,
  };
}

/** The bridge as the preload gives it, with a publication the test ends by hand. */
function stubBridge() {
  const bridge = {
    listener: undefined as ((raw: unknown) => void) | undefined,
    stop: vi.fn(),
    fail: (_error: Error) => undefined as void,
  };
  vi.stubGlobal('window', {
    architect: {
      graduates: {
        onPublishProgress: (listener: (raw: unknown) => void) => {
          bridge.listener = listener;
          return bridge.stop;
        },
        publish: () =>
          new Promise((_resolve, reject: (error: Error) => void) => {
            bridge.fail = reject;
          }),
        publications: () => Promise.resolve([]),
      },
    },
  });
  return bridge;
}

afterEach(() => {
  usePublishing.setState({ states: {} });
  vi.unstubAllGlobals();
});

describe('a publication on its way', () => {
  it('follows the engine apart from any screen, and ends failed with the reason', async () => {
    const bridge = stubBridge();
    const done = startPublishing('grd_1', TARGET, {
      repository: 'jake/desk',
      visibility: 'private',
    });
    expect(usePublishing.getState().states['grd_1']).toEqual({
      kind: 'publishing',
      ...TARGET,
      progress: null,
    });

    bridge.listener?.(uploading(40));
    // Another agent's progress, and anything that isn't progress, change nothing.
    bridge.listener?.(uploading(90, 'grd_other'));
    bridge.listener?.({ stage: 'uploading' });
    expect(usePublishing.getState().states['grd_1']).toMatchObject({
      kind: 'publishing',
      progress: uploading(40),
    });

    bridge.fail(new Error('Hugging Face answered with an error (503).'));
    await done;
    expect(usePublishing.getState().states['grd_1']).toEqual({
      kind: 'failed',
      ...TARGET,
      message: 'Hugging Face answered with an error (503).',
    });
    expect(bridge.stop).toHaveBeenCalledOnce();
  });
});

describe('lastTarget', () => {
  it('names where the last publication went, so the tab opens on it again', () => {
    expect(lastTarget(IDLE)).toBeNull();
    expect(lastTarget({ kind: 'failed', ...TARGET, message: 'Down' })).toEqual({
      repository: 'jake/desk',
      visibility: 'private',
    });
    expect(lastTarget({ kind: 'publishing', ...TARGET, progress: null })).toEqual({
      repository: 'jake/desk',
      visibility: 'private',
    });
  });
});
