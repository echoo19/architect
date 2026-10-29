import type { LlamaServerStatus } from '@architect/shared';
import { describe, expect, it } from 'vitest';
import { llamaServerRowState } from '../../../src/renderer/src/settings/models/llamaServerState';

const CHOSEN = 'C:\\llama.cpp\\llama-server.exe';

describe('the llama.cpp row in Settings', () => {
  it('shows the build, and where it came from when it was chosen', () => {
    const onPath: LlamaServerStatus = {
      source: 'path',
      path: '/usr/local/bin/llama-server',
      build: 10472,
      ready: true,
      minimumBuild: 10358,
    };
    expect(llamaServerRowState(onPath, undefined)).toEqual({
      found: { build: 10472, path: null },
      problem: null,
      details: null,
      tooOld: false,
      canClear: false,
    });
    expect(
      llamaServerRowState({ ...onPath, source: 'setting', path: CHOSEN }, CHOSEN),
    ).toMatchObject({ found: { build: 10472, path: CHOSEN }, canClear: true });
  });

  it('says a build is too old, with how to fix it', () => {
    expect(
      llamaServerRowState(
        {
          source: 'path',
          path: '/usr/local/bin/llama-server',
          build: 9000,
          ready: false,
          problem:
            'llama-server is build 9000, older than 10358, the first that runs Muse Glimmer.',
          hint: 'Update llama.cpp to build 10358 or newer.',
          minimumBuild: 10358,
        },
        undefined,
      ),
    ).toEqual({
      found: null,
      problem: 'Build 9000 is too old. Build 10358 or newer is needed.',
      details:
        'llama-server is build 9000, older than 10358, the first that runs Muse Glimmer. Update llama.cpp to build 10358 or newer.',
      tooOld: true,
      canClear: false,
    });
  });

  it('offers going back to PATH when a chosen program is gone, as its hint says to', () => {
    const gone: LlamaServerStatus = {
      source: null,
      ready: false,
      problem: `The llama-server set in Settings isn't at ${CHOSEN}.`,
      hint: 'Choose the llama-server program from your llama.cpp folder in Settings, or clear the setting to use the one on PATH.',
      minimumBuild: 10358,
    };
    expect(llamaServerRowState(gone, CHOSEN)).toMatchObject({
      found: null,
      canClear: true,
      problem: "The program you chose isn't there anymore.",
      details: expect.stringContaining('clear the setting') as unknown,
    });
    // Nothing chosen and nothing on PATH is plainly not installed, with the engine's words kept.
    expect(llamaServerRowState(gone, undefined)).toMatchObject({
      problem: 'Not installed. Agents with trained weights need it.',
      canClear: false,
    });
  });

  it('shows nothing found or wrong before the first check', () => {
    expect(llamaServerRowState(undefined, undefined)).toEqual({
      found: null,
      problem: null,
      details: null,
      tooOld: false,
      canClear: false,
    });
  });
});
