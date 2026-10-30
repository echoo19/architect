import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
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

  it('takes a program only when the user picked exactly that file', () => {
    const picked = new PickedPaths();
    const program = join(ROOT, 'llama.cpp', 'llama-server.exe');
    const folder = join(ROOT, 'exports');
    picked.add([program], 'files');
    picked.add([folder], 'folders');
    expect(picked.checkFile(program)).toBe(program);
    const refused = 'Architect only runs a program you choose.';
    // A file inside a folder chosen for something else is not a program the user chose.
    expect(() => picked.checkFile(join(folder, 'llama-server.exe'))).toThrow(refused);
    expect(() => picked.checkFile(folder)).toThrow(refused);
    expect(() => picked.checkFile(join(ROOT, 'llama.cpp', 'other.exe'))).toThrow(refused);
  });
});

describe('PickedPaths and links', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });
  const LEAVES = 'leads out of the folder you chose';

  /** A chosen folder and a sibling outside it, both real. */
  function layout() {
    const base = realpathSync(mkdtempSync(join(tmpdir(), 'architect-picked-')));
    dirs.push(base);
    const chosen = join(base, 'chosen');
    const outside = join(base, 'outside');
    mkdirSync(join(chosen, 'inner'), { recursive: true });
    mkdirSync(outside);
    writeFileSync(join(outside, 'secret.txt'), 'secret');
    writeFileSync(join(chosen, 'inner', 'file.txt'), 'ok');
    const picked = new PickedPaths();
    picked.add([chosen], 'folders');
    return { base, chosen, outside, picked };
  }

  /** A symlink, or on Windows a junction, which needs no privilege; false where neither works. */
  function link(target: string, path: string, kind: 'dir' | 'file'): boolean {
    try {
      symlinkSync(target, path, kind === 'dir' ? 'junction' : 'file');
      return true;
    } catch {
      return false;
    }
  }

  it('allows real paths in a chosen folder, even ones not made yet', () => {
    const { chosen, picked } = layout();
    expect(picked.check(join(chosen, 'inner', 'file.txt'))).toBe(join(chosen, 'inner', 'file.txt'));
    expect(picked.check(join(chosen, 'inner', 'new', 'out.json'))).toBe(
      join(chosen, 'inner', 'new', 'out.json'),
    );
  });

  it('allows a link that stays inside the chosen folder', (context) => {
    const { chosen, picked } = layout();
    if (!link(join(chosen, 'inner'), join(chosen, 'alias'), 'dir')) context.skip();
    expect(picked.check(join(chosen, 'alias', 'file.txt'))).toBe(join(chosen, 'inner', 'file.txt'));
  });

  it('refuses a folder link that leads outside the chosen folder', (context) => {
    const { chosen, outside, picked } = layout();
    if (!link(outside, join(chosen, 'escape'), 'dir')) context.skip();
    expect(() => picked.check(join(chosen, 'escape'))).toThrow(LEAVES);
    expect(() => picked.check(join(chosen, 'escape', 'secret.txt'))).toThrow(LEAVES);
    expect(() => picked.check(join(chosen, 'escape', 'new', 'out.json'))).toThrow(LEAVES);
  });

  it('refuses a file link that leads outside the chosen folder', (context) => {
    const { chosen, outside, picked } = layout();
    if (!link(join(outside, 'secret.txt'), join(chosen, 'secret.txt'), 'file')) context.skip();
    expect(() => picked.check(join(chosen, 'secret.txt'))).toThrow(LEAVES);
  });

  it('refuses a link that points nowhere, since writing through it would create the target', (context) => {
    const { base, chosen, picked } = layout();
    if (!link(join(base, 'not-made-yet'), join(chosen, 'dangling'), 'dir')) context.skip();
    expect(() => picked.check(join(chosen, 'dangling', 'out.json'))).toThrow(LEAVES);
  });
});
