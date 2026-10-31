import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { processResources, unpackedPath } from '../../../src/main/processes/resources';

const ROOT = resolve('/work');

describe('processResources', () => {
  it('uses the build output and the repository in development', () => {
    const app = join(ROOT, 'architect', 'apps', 'desktop');
    const resources = processResources({
      outDir: join(app, 'out', 'main'),
      packaged: false,
      appPath: app,
      resourcesPath: join(ROOT, 'electron', 'resources'),
    });
    expect(resources).toEqual({
      sandboxEntry: join(app, 'out', 'sandbox', 'child.mjs'),
      agentHostEntry: join(app, 'out', 'agent-host', 'main.mjs'),
      sampleJobFile: join(ROOT, 'architect', 'examples', 'home-services', 'job', 'job.json'),
      academyJobFile: join(ROOT, 'architect', 'examples', 'academy', 'job', 'job.json'),
      sweepDeskJobFile: join(ROOT, 'architect', 'examples', 'sweep-desk', 'job', 'job.json'),
      // The ready-made agent's package, where the owner puts it, and the returns desk's own data.
      sampleAgentFile: join(
        ROOT,
        'architect',
        'examples',
        'gear-returns',
        'graduate',
        'returns-desk.architect.zip',
      ),
      sampleAgentDataDir: join(ROOT, 'architect', 'examples', 'gear-returns', 'graduate', 'data'),
      trainerDir: join(ROOT, 'architect', 'trainer'),
    });
  });

  it('uses the unpacked sandbox and the shipped sample job and agent once packaged', () => {
    const resourcesPath = join(ROOT, 'Architect', 'resources');
    const archive = join(resourcesPath, 'app.asar');
    const resources = processResources({
      outDir: join(archive, 'out', 'main'),
      packaged: true,
      appPath: archive,
      resourcesPath,
    });
    expect(resources).toEqual({
      sandboxEntry: join(resourcesPath, 'app.asar.unpacked', 'out', 'sandbox', 'child.mjs'),
      agentHostEntry: join(archive, 'out', 'agent-host', 'main.mjs'),
      sampleJobFile: join(resourcesPath, 'sample-job', 'job.json'),
      academyJobFile: join(resourcesPath, 'academy-job', 'job.json'),
      sweepDeskJobFile: join(resourcesPath, 'sweep-desk-job', 'job.json'),
      sampleAgentFile: join(resourcesPath, 'sample-agent', 'returns-desk.architect.zip'),
      sampleAgentDataDir: join(resourcesPath, 'sample-agent', 'data'),
      trainerDir: join(resourcesPath, 'trainer'),
    });
  });

  it('only rewrites a folder named exactly app.asar', () => {
    const path = join(ROOT, 'my-app.asar-files', 'child.mjs');
    expect(unpackedPath(path)).toBe(path);
  });
});
