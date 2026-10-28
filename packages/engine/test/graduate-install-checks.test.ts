import { INSTALL_CHECKS_LABEL } from '@architect/shared';
import { afterEach, describe, expect, it } from 'vitest';
import {
  addVersion,
  newComputer,
  PRICE_TOOL,
  harnessWith,
  type Computer,
} from './support/computer';

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function computer(): Promise<Computer> {
  const made = await newComputer();
  cleanups.push(() => made.remove());
  return made;
}

describe('a graduate made here never shows as unchecked', () => {
  it('runs its install checks the first time it is listed, without loading the model', async () => {
    const here = await computer();
    await addVersion(here, { graduateId: 'grd_desk' });
    expect(here.library.list()).toMatchObject([{ id: 'grd_desk', status: 'unchecked' }]);

    const [listed] = await here.library.listChecked();
    expect(listed).toMatchObject({ id: 'grd_desk', status: 'ready', reasons: [] });
    expect(here.library.installation('grd_desk')).toMatchObject({
      label: INSTALL_CHECKS_LABEL,
      status: 'ready',
    });
    const responds = here.library
      .installation('grd_desk')
      .checks.find((check) => check.kind === 'model_responds');
    expect(responds).toMatchObject({ status: 'skipped', detail: 'Not asked for.' });
    // The model was described, never sent a request.
    expect(here.students.flatMap((student) => student.chats)).toEqual([]);

    const checks = here.store.installationChecks.get('grd_desk', 1);
    await here.library.listChecked();
    expect(here.store.installationChecks.get('grd_desk', 1)).toEqual(checks);
  });

  it('shows why when a check fails, with what to do', async () => {
    const here = await computer();
    await addVersion(here, {
      graduateId: 'grd_desk',
      harness: harnessWith('Service desk', {
        tools: [{ ...PRICE_TOOL, code: 'function run(args, ctx) {\n  return syntax error;\n}\n' }],
      }),
    });
    const [listed] = await here.library.listChecked();
    expect(listed).toMatchObject({ status: 'blocked' });
    expect(listed?.reasons).toEqual(["Its tool invoice_total doesn't load: SyntaxError on line 1"]);
  });

  it('checks a version it rolls back to, so the one chats now run on is checked too', async () => {
    const here = await computer();
    await addVersion(here, { graduateId: 'grd_desk' });
    await addVersion(here, { graduateId: 'grd_desk', parent: 1 });
    await here.library.listChecked();
    here.library.promote('grd_desk', 2);
    expect(here.library.summary('grd_desk').status).toBe('unchecked');
    await here.library.ensureChecked('grd_desk');
    expect(here.library.summary('grd_desk')).toMatchObject({ activeVersion: 2, status: 'ready' });
    here.library.rollback('grd_desk', 1);
    expect(here.library.summary('grd_desk')).toMatchObject({ activeVersion: 1, status: 'ready' });
  });

  it('says so when its checks cannot run at all, and tries again next time', async () => {
    const here = await computer();
    await addVersion(here, { graduateId: 'grd_desk' });
    const sandbox = here.library.ctx.deps.runtime;
    const working = sandbox.createSandbox;
    sandbox.createSandbox = () => Promise.reject(new Error('The tool sandbox would not start.'));
    const [listed] = await here.library.listChecked();
    expect(listed).toMatchObject({
      status: 'unchecked',
      reasons: ["Its install checks couldn't run: The tool sandbox would not start."],
    });
    sandbox.createSandbox = working;
    const [again] = await here.library.listChecked();
    expect(again).toMatchObject({ status: 'ready', reasons: [] });
  });
});
