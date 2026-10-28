import { afterEach, describe, expect, it, vi } from 'vitest';
import { openSampleAgent, useImportSession } from '../../../src/renderer/src/import/session';

const SAMPLE = {
  package: 'C:\\Architect\\resources\\sample-agent\\returns-desk.architect.zip',
  data: 'C:\\Users\\dana\\AppData\\Roaming\\Architect\\samples\\returns-desk\\data',
};

/** The bridge as the preload gives it, and the location the app routes by. */
function stubWindow(prepare: () => Promise<unknown>): { hash: string } {
  const location = { hash: '' };
  vi.stubGlobal('window', {
    architect: { graduates: { prepareSampleAgent: prepare } },
    location,
  });
  return location;
}

afterEach(() => {
  useImportSession.setState({ source: null });
  vi.unstubAllGlobals();
});

describe('opening the ready-made agent', () => {
  it('starts the import on its package with data/ already chosen, and shows the import', async () => {
    const location = stubWindow(async () => SAMPLE);
    await openSampleAgent();
    expect(useImportSession.getState().source).toEqual({
      kind: 'file',
      path: SAMPLE.package,
      bindings: { data: SAMPLE.data },
    });
    expect(location.hash).toBe('/import');
  });

  it('changes nothing, and says why, when its data could not be copied', async () => {
    const location = stubWindow(async () => {
      throw new Error("The ready-made agent's data couldn't be copied. There is no space left.");
    });
    await expect(openSampleAgent()).rejects.toThrow('There is no space left.');
    expect(useImportSession.getState().source).toBeNull();
    expect(location.hash).toBe('');
  });

  it('changes nothing when the engine answers with something that is not a package and a folder', async () => {
    const location = stubWindow(async () => ({ package: SAMPLE.package }));
    await expect(openSampleAgent()).rejects.toThrow(
      "Architect received data it couldn't read from graduates.prepareSampleAgent.",
    );
    expect(useImportSession.getState().source).toBeNull();
    expect(location.hash).toBe('');
  });
});

describe('choosing a package', () => {
  it('takes the folders it is given, and none from the package chosen before', () => {
    const { choose } = useImportSession.getState();
    choose(SAMPLE.package, { data: SAMPLE.data });
    choose('C:\\Users\\dana\\Downloads\\returns-desk-v1.architect.zip');
    expect(useImportSession.getState().source).toEqual({
      kind: 'file',
      path: 'C:\\Users\\dana\\Downloads\\returns-desk-v1.architect.zip',
    });
  });
});
