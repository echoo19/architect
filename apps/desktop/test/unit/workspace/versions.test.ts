import type { GraduateVersion, InstallCheck, Installation } from '@architect/shared';
import { describe, expect, it } from 'vitest';
import { checkDetail } from '../../../src/renderer/src/install/labels';
import {
  moveFor,
  promoteCaution,
  versionOrigin,
} from '../../../src/renderer/src/workspace/settings/versions';

/** A version with only what these helpers read; the rest of the manifest doesn't matter here. */
function version(patch: {
  version: number;
  state?: GraduateVersion['state'];
  active?: boolean;
  evaluation?: GraduateVersion['evaluation'];
  parent?: number;
  imported?: boolean;
  score?: { pass: number; total: number; target: number };
}): GraduateVersion {
  const summary = patch.score && {
    score: { pass: patch.score.pass, total: patch.score.total },
    perType: [],
    passRate: {
      target: patch.score.target,
      actual: patch.score.pass / patch.score.total,
      met: patch.score.pass / patch.score.total >= patch.score.target,
    },
  };
  return {
    version: patch.version,
    state: patch.state ?? 'accepted',
    active: patch.active ?? false,
    evaluation: patch.evaluation ?? 'ready',
    ...(patch.parent === undefined ? {} : { parent: patch.parent }),
    ...(patch.imported ? { origin: { agentId: 'grd_x', version: 1, digest: 'sha256:x' } } : {}),
    manifest: { evidence: summary ? { summary } : {} },
  } as unknown as GraduateVersion;
}

describe('version moves', () => {
  it('promotes a candidate or a newer version and rolls back to an older one', () => {
    expect(moveFor(version({ version: 3, state: 'candidate' }), 2)).toBe('promote');
    expect(moveFor(version({ version: 1, state: 'candidate' }), 2)).toBe('promote');
    expect(moveFor(version({ version: 3 }), 2)).toBe('promote');
    expect(moveFor(version({ version: 1 }), 2)).toBe('rollback');
    expect(moveFor(version({ version: 2, active: true }), 2)).toBeNull();
    expect(moveFor(version({ version: 4, state: 'rejected' }), 2)).toBeNull();
  });

  it('says where a version came from', () => {
    expect(versionOrigin(version({ version: 1 }))).toBeNull();
    expect(versionOrigin(version({ version: 2, parent: 1 }))).toBe('from v1');
    expect(versionOrigin(version({ version: 3, imported: true }))).toBe('imported');
    expect(versionOrigin(version({ version: 4, parent: 3, imported: true }))).toBe(
      'from v3, imported',
    );
  });
});

describe('promoting a version its locked test did not vouch for', () => {
  it('says nothing measured it', () => {
    expect(promoteCaution(version({ version: 4, evaluation: 'unevaluated' }))).toBe(
      'No locked test has measured version 4.',
    );
  });

  it('says by how much it fell short of the bar', () => {
    const short = version({
      version: 1,
      evaluation: 'experimental',
      score: { pass: 51, total: 60, target: 0.9 },
    });
    expect(promoteCaution(short)).toBe('Version 1 fell short of its bar: 85% passed, 90% needed.');
  });

  it('says when it met the bar only on a hosted copy', () => {
    const hosted = version({
      version: 2,
      evaluation: 'experimental',
      score: { pass: 57, total: 60, target: 0.9 },
    });
    expect(promoteCaution(hosted)).toBe(
      'Version 2 was measured on a hosted copy, not on a computer like this one.',
    );
  });

  it('has nothing to add for a version that met its bar', () => {
    expect(
      promoteCaution(version({ version: 3, score: { pass: 57, total: 60, target: 0.9 } })),
    ).toBeNull();
  });
});

describe('install check details', () => {
  const installation = {
    model: { runtime: 'ollama', baseUrl: 'http://127.0.0.1:11434', model: 'muse-glimmer:30b' },
    machine: { os: 'win32', arch: 'x64', memoryBytes: 32 * 1024 ** 3 },
  } as unknown as Installation;
  const check = (patch: Partial<InstallCheck>): InstallCheck => ({
    id: 'check',
    kind: 'compatibility',
    status: 'passed',
    detail: '',
    ...patch,
  });

  it('names this computer and its runtime without an address', () => {
    expect(
      checkDetail(
        check({ detail: 'win32/x64, 32 GB of memory, ollama at 127.0.0.1:11434.' }),
        installation,
      ),
    ).toBe('Windows x64 · 32 GB · Ollama');
  });

  it('says a passed setup and folders check in plain words', () => {
    expect(
      checkDetail(
        check({ kind: 'harness_valid', detail: 'Harness version 8, as tested.' }),
        installation,
      ),
    ).toBe('The same setup that was tested');
    expect(
      checkDetail(
        check({
          kind: 'resources_bound',
          detail: 'Every folder is chosen and holds the files it should.',
        }),
        installation,
      ),
    ).toBe('Every folder is chosen and has its files');
  });

  it('says why a model check was not tried', () => {
    const skipped = (detail: string) =>
      checkDetail(check({ kind: 'model_responds', status: 'skipped', detail }), installation);
    expect(skipped('Skipped: this computer cannot run it as it is.')).toBe(
      'Not tried, since a check above failed',
    );
    expect(skipped('Skipped: the model is not available.')).toBe(
      'Not tried, since a check above failed',
    );
    expect(skipped('Not asked for.')).toBe('Not tried yet');
  });

  it("keeps a failed check's own words, which say what to do", () => {
    const reason = "Its tool lookup_order doesn't load: SyntaxError: unexpected token on line 3";
    expect(
      checkDetail(check({ kind: 'tools_load', status: 'failed', detail: reason }), installation),
    ).toBe(reason);
  });
});
