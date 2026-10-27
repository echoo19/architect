import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PickedPaths } from '../../../src/main/files/picked';

const ROOT = resolve('/work');
const REFUSED = 'Architect only opens files and folders you choose.';

describe('PickedPaths', () => {
  it('allows exactly the files the user picked', () => {
    const picked = new PickedPaths();
    const job = join(ROOT, 'jobs', 'job.json');
    picked.add([job], 'files');
    expect(picked.check(job)).toBe(job);
    expect(() => picked.check(join(ROOT, 'jobs', 'other.json'))).toThrow(REFUSED);
    expect(() => picked.check(join(job, 'inside'))).toThrow(REFUSED);
  });

  it('allows a picked folder and anything inside it', () => {
    const picked = new PickedPaths();
    const folder = join(ROOT, 'exports');
    picked.add([folder], 'folders');
    expect(picked.check(folder)).toBe(folder);
    expect(picked.check(join(folder, 'service-desk', 'job.json'))).toBe(
      join(folder, 'service-desk', 'job.json'),
    );
  });

  it('refuses paths that only look like they are inside a picked folder', () => {
    const picked = new PickedPaths();
    const folder = join(ROOT, 'exports');
    picked.add([folder], 'folders');
    expect(() => picked.check(join(ROOT, 'exports-evil', 'job.json'))).toThrow(REFUSED);
    expect(() => picked.check(`${folder}/../secrets.json`)).toThrow(REFUSED);
    expect(() => picked.check(join(ROOT, 'elsewhere'))).toThrow(REFUSED);
  });

  it('refuses everything before anything is picked', () => {
    expect(() => new PickedPaths().check(join(ROOT, 'job.json'))).toThrow(REFUSED);
  });
});
