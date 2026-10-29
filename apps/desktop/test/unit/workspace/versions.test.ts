import type {
  GraduateVersion,
  InstallCheck,
  Installation,
  PackageManifest,
} from '@architect/shared';
import { describe, expect, it } from 'vitest';
import { folderName } from '../../../src/renderer/src/install/folders';
import {
  checkDetail,
  checkMark,
  fixesFor,
  installProblem,
  needsAnotherModel,
  needsLlama,
  stepsNeedingAttention,
} from '../../../src/renderer/src/install/labels';
import {
  evaluationNote,
  MOVE_WORDS,
  moveFor,
  promoteCaution,
  standing,
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
    expect(versionOrigin(version({ version: 2, parent: 1 }))).toBe('from version 1');
    expect(versionOrigin(version({ version: 3, imported: true }))).toBe('imported');
    expect(versionOrigin(version({ version: 4, parent: 3, imported: true }))).toBe(
      'from version 3, imported',
    );
  });

  it('names what each version is to the agent, and each move in plain words', () => {
    expect(standing(version({ version: 2, active: true }), 2)).toBe('In use');
    expect(standing(version({ version: 4, state: 'candidate' }), 2)).toBe('New, not in use yet');
    expect(standing(version({ version: 3 }), 2)).toBe('Newer, not in use');
    expect(standing(version({ version: 1 }), 2)).toBe('Earlier version');
    expect(standing(version({ version: 5, state: 'rejected' }), 2)).toBe('Set aside');
    expect(MOVE_WORDS.promote.action).toBe('Use this version');
    expect(MOVE_WORDS.rollback.action).toBe('Go back to this version');
    expect(MOVE_WORDS.promote.title(3)).toBe('Use version 3?');
    expect(MOVE_WORDS.rollback.title(2)).toBe('Go back to version 2?');
  });
});

describe('promoting a version its final test did not vouch for', () => {
  it('says nothing measured it', () => {
    expect(promoteCaution(version({ version: 4, evaluation: 'unevaluated' }))).toBe(
      "Version 4 hasn't taken a final test.",
    );
  });

  it('says by how much it fell short of the bar', () => {
    const short = version({
      version: 1,
      evaluation: 'experimental',
      score: { pass: 51, total: 60, target: 0.9 },
    });
    expect(promoteCaution(short)).toBe(
      'Version 1 fell short on its final test: 85% passed, 90% needed.',
    );
  });

  it('says when it met the bar only on a hosted copy', () => {
    const hosted = version({
      version: 2,
      evaluation: 'experimental',
      score: { pass: 57, total: 60, target: 0.9 },
    });
    expect(promoteCaution(hosted)).toBe(
      'Version 2 took its final test online, not on a computer like this one.',
    );
  });

  it('says why a version is experimental where its standing is listed', () => {
    const short = version({
      version: 1,
      evaluation: 'experimental',
      score: { pass: 51, total: 60, target: 0.9 },
    });
    const hosted = version({
      version: 2,
      evaluation: 'experimental',
      score: { pass: 57, total: 60, target: 0.9 },
    });
    expect(evaluationNote(short)).toBe('Below its 90% target');
    expect(evaluationNote(hosted)).toBe('Final test run online');
    expect(evaluationNote(version({ version: 3 }))).toBe('Passed its final test');
    expect(evaluationNote(version({ version: 4, evaluation: 'unevaluated' }))).toBe(
      'No final test yet',
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
    checks: [],
  } as unknown as Installation;
  const check = (patch: Partial<InstallCheck>): InstallCheck => ({
    id: 'check',
    kind: 'compatibility',
    status: 'passed',
    detail: '',
    ...patch,
  });

  it('names this computer alone, since what runs the model has rows of its own', () => {
    expect(
      checkDetail(
        check({ detail: 'win32/x64, 32 GB of memory, ollama at 127.0.0.1:11434.' }),
        installation,
      ),
    ).toBe('Windows x64 · 32 GB');
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

  it('says why a model check was not tried, from the reason the engine gives it', () => {
    const skipped = (patch: Partial<InstallCheck>) =>
      checkDetail(
        check({ kind: 'model_responds', status: 'skipped', detail: 'Whatever it says.', ...patch }),
        installation,
      );
    expect(skipped({ skipped: 'after_failure' })).toBe('Not tried, since a check above failed');
    expect(skipped({ skipped: 'not_asked' })).toBe('Not tried yet');
    // A check stored before the reason existed keeps its own words, never read for meaning.
    expect(skipped({ detail: 'Skipped: the model is not available.' })).toBe(
      'Skipped: the model is not available',
    );
  });

  it('names the tested build only when the engine says the base is that build', () => {
    const available = (patch: Partial<InstallCheck>) =>
      checkDetail(
        check({ kind: 'model_available', detail: 'muse-glimmer:30b on ollama.', ...patch }),
        installation,
      );
    expect(available({ sameBuild: true })).toBe(
      'muse-glimmer:30b on Ollama, the build that was tested',
    );
    expect(available({})).toBe('muse-glimmer:30b on Ollama');
    expect(available({ detail: 'the same build that was tested, says the sentence' })).toBe(
      'muse-glimmer:30b on Ollama',
    );
  });

  it('says any other passed check in its own words, like the rows around it', () => {
    expect(checkDetail(check({ kind: 'tools_load', detail: '1 tool loaded.' }), installation)).toBe(
      '1 tool loaded',
    );
    expect(
      checkDetail(
        check({ kind: 'model_responds', detail: 'Answered in 2.8 s, loading included.' }),
        installation,
      ),
    ).toBe('Answered in 2.8 s, loading included');
  });

  it("keeps a failed check's own words, which say what to do", () => {
    const reason = "Its tool lookup_order doesn't load: SyntaxError: unexpected token on line 3";
    expect(
      checkDetail(check({ kind: 'tools_load', status: 'failed', detail: reason }), installation),
    ).toBe(reason);
  });

  describe('for a version with trained weights, which llama.cpp serves', () => {
    const missing =
      "llama-server isn't installed, or isn't on PATH. Install llama.cpp (build 10358 or newer), then choose its llama-server in Settings or add its folder to PATH.";
    const server = check({
      id: 'adapter-runtime',
      kind: 'adapter_runtime',
      detail: 'llama-server build 10472, at C:\\llama.cpp\\llama-server.exe.',
      build: 10472,
    });
    const served = { ...installation, checks: [server] } as Installation;

    it("names llama.cpp's build and the base its weights need, never in the computer's row", () => {
      expect(checkDetail(check({ detail: 'win32/x64, 32 GB of memory, llama.cpp.' }), served)).toBe(
        'Windows x64 · 32 GB',
      );
      expect(checkDetail(server, served)).toBe('Build 10472');
      // Without the build the engine found, the row keeps the engine's words.
      const { build: _build, ...unnumbered } = server;
      expect(checkDetail(unnumbered, served)).toBe(
        'llama-server build 10472, at C:\\llama.cpp\\llama-server.exe',
      );
      expect(
        checkDetail(
          check({
            kind: 'model_available',
            detail: "muse-glimmer:30b in Ollama's store, the build its adapter was trained on.",
          }),
          served,
        ),
      ).toBe('muse-glimmer:30b, the exact copy its trained weights need');
    });

    it('offers to set up llama.cpp when it is missing, and never reads that as blocking', () => {
      const failed = { ...server, status: 'failed' as const, detail: missing };
      const needing = {
        ...served,
        status: 'needs_attention',
        bindings: {},
        grants: { writes: 'ask', resources: {} },
        checks: [failed],
      } as unknown as Installation;
      const manifest = { resources: [] } as unknown as PackageManifest;
      expect(fixesFor(needing, manifest)).toEqual([{ kind: 'llama' }, { kind: 'check' }]);
      expect(checkDetail(failed, needing)).toBe(missing);
      expect(checkMark(failed, 'blocked')).toBe('attention');
      expect(
        checkMark({ ...failed, kind: 'model_available', id: 'model-available' }, 'blocked'),
      ).toBe('blocked');
    });

    it('offers another model for a base of another build, even though it blocks', () => {
      const otherBuild = {
        ...served,
        status: 'blocked',
        bindings: {},
        grants: { writes: 'ask', resources: {} },
        checks: [
          server,
          check({
            id: 'model-available',
            kind: 'model_available',
            status: 'failed',
            detail: 'muse-glimmer:30b on this computer is another build.',
            sameBuild: false,
            modelProblem: 'other_build',
          }),
        ],
      } as unknown as Installation;
      const manifest = { resources: [] } as unknown as PackageManifest;
      expect(needsAnotherModel(otherBuild)).toBe(true);
      expect(fixesFor(otherBuild, manifest)).toEqual([{ kind: 'model' }]);
    });
  });
});

describe('ways out of what the checks found', () => {
  const data = { name: 'data', required: true, access: 'read_write' } as const;
  const output = { name: 'output', required: false, access: 'read_write' } as const;
  const manifest = { resources: [data, output] } as unknown as PackageManifest;
  const installation = (patch: Partial<Installation>): Installation =>
    ({
      status: 'needs_attention',
      model: { runtime: 'ollama', baseUrl: 'http://127.0.0.1:11434', model: 'muse-glimmer:30b' },
      bindings: { data: 'C:\\records' },
      grants: { writes: 'ask', resources: { data: 'read_write' } },
      checks: [],
      reasons: [],
      ...patch,
    }) as unknown as Installation;
  const folders = (problems: { name: string; problem: string }[]): InstallCheck =>
    ({
      id: 'resources-bound',
      kind: 'resources_bound',
      status: 'failed',
      detail: 'A sentence that is never read for meaning: data/ something.',
      folders: problems,
    }) as InstallCheck;

  it("reads each folder's problem from the check, never from its sentence", () => {
    expect(
      fixesFor(installation({ checks: [folders([{ name: 'data', problem: 'files' }])] }), manifest),
    ).toEqual([{ kind: 'choose', resource: 'data', again: true }, { kind: 'check' }]);
    expect(
      fixesFor(
        installation({
          bindings: {},
          checks: [folders([{ name: 'data', problem: 'not_chosen' }])],
        }),
        manifest,
      ),
    ).toEqual([{ kind: 'choose', resource: 'data', again: false }, { kind: 'check' }]);
    expect(
      fixesFor(
        installation({ checks: [folders([{ name: 'data', problem: 'not_allowed' }])] }),
        manifest,
      ),
    ).toEqual([{ kind: 'allow', resource: 'data', grant: 'read_write' }, { kind: 'check' }]);
  });

  it('marks the step that left a folder undone, from the folders check and not its sentence', () => {
    expect(stepsNeedingAttention(installation({ checks: [] }))).toEqual([]);
    expect(stepsNeedingAttention(undefined)).toEqual([]);
    expect(
      stepsNeedingAttention(
        installation({ checks: [folders([{ name: 'data', problem: 'not_chosen' }])] }),
      ),
    ).toEqual(['Folders']);
    expect(
      stepsNeedingAttention(
        installation({ checks: [folders([{ name: 'data', problem: 'not_allowed' }])] }),
      ),
    ).toEqual(['Permissions']);
    expect(
      stepsNeedingAttention(
        installation({
          checks: [
            folders([
              { name: 'data', problem: 'missing' },
              { name: 'output', problem: 'not_allowed' },
            ]),
          ],
        }),
      ),
    ).toEqual(['Folders', 'Permissions']);
  });

  it('waits for llama.cpp only while its own check has failed', () => {
    const runtime = (status: InstallCheck['status']): InstallCheck => ({
      id: 'adapter-runtime',
      kind: 'adapter_runtime',
      status,
      detail: 'A sentence that is never read for meaning.',
    });
    expect(needsLlama({ checks: [] })).toBe(false);
    expect(needsLlama({ checks: [runtime('passed')] })).toBe(false);
    expect(needsLlama({ checks: [runtime('skipped')] })).toBe(false);
    expect(needsLlama({ checks: [runtime('failed')] })).toBe(true);
    // Another check failing is not llama.cpp's trouble.
    expect(needsLlama({ checks: [folders([{ name: 'data', problem: 'missing' }])] })).toBe(false);
  });

  it('says which folder is the trouble, by what it holds, and when several are', () => {
    const say = (problems: { name: string; problem: string }[]) =>
      installProblem(installation({ checks: [folders(problems)] }), { model: 'Glimmer' })?.cause;
    expect(say([{ name: 'data', problem: 'not_chosen' }])).toBe(
      "Its records folder isn't chosen yet.",
    );
    expect(say([{ name: 'data', problem: 'not_allowed' }])).toBe(
      "It isn't allowed to use its records folder yet.",
    );
    expect(say([{ name: 'data', problem: 'missing' }])).toBe("Its records folder can't be found.");
    expect(say([{ name: 'output', problem: 'files' }])).toBe(
      'Its output folder is missing files it needs.',
    );
    expect(
      say([
        { name: 'data', problem: 'not_chosen' },
        { name: 'output', problem: 'not_chosen' },
      ]),
    ).toBe("Some of the folders it needs aren't ready.");
    expect(say([])).toBe("A folder it needs isn't ready.");
  });

  it('names a package folder by what it holds, never by its name with a slash', () => {
    expect(folderName(data)).toBe('Records folder');
    expect(folderName(output)).toBe('Output folder');
    expect(folderName({ name: 'labels' })).toBe('Labels folder');
  });

  it('offers a download for a base that is missing, and another model for another build', () => {
    const base = (patch: Partial<InstallCheck>) =>
      ({
        id: 'model-available',
        kind: 'model_available',
        status: 'failed',
        detail: "Ollama can't serve muse-glimmer:30b.",
        ...patch,
      }) as InstallCheck;
    expect(
      fixesFor(installation({ checks: [base({ modelProblem: 'not_downloaded' })] }), manifest),
    ).toEqual([{ kind: 'download', model: 'muse-glimmer:30b' }, { kind: 'check' }]);
    expect(
      fixesFor(installation({ checks: [base({ modelProblem: 'other_build' })] }), manifest),
    ).toEqual([{ kind: 'model' }, { kind: 'check' }]);
    const wrongRuntime = {
      id: 'compatibility',
      kind: 'compatibility',
      status: 'failed',
      detail: 'Set its model to muse-glimmer:30b on Ollama.',
      modelProblem: 'wrong_runtime',
    } as InstallCheck;
    expect(fixesFor(installation({ checks: [wrongRuntime] }), manifest)).toEqual([
      { kind: 'model' },
      { kind: 'check' },
    ]);
  });
});
