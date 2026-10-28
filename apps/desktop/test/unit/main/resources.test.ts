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
      trainerDir: join(ROOT, 'architect', 'trainer'),
    });
  });

  it('uses the unpacked sandbox and the shipped sample job once packaged', () => {
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
      trainerDir: join(resourcesPath, 'trainer'),
    });
  });

  it('only rewrites a folder named exactly app.asar', () => {
    const path = join(ROOT, 'my-app.asar-files', 'child.mjs');
    expect(unpackedPath(path)).toBe(path);
  });
});
