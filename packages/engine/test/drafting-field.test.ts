import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DraftOrganization, MentorCompletionRequest, Task } from '@architect/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { releaseMentor } from '../src/vault/gate';
import {
  draft,
  draftingWorld,
  EMAIL_TYPE,
  NO_TYPE,
  PENDING_TYPE,
  TEACHER,
  type DraftingWorld,
} from './support/drafting-world';
import { shopData } from './support/drafting-data';
import { step, wireRule } from './support/rule-draft';

let world: DraftingWorld;

beforeEach(() => {
  world = draftingWorld();
});

afterEach(() => {
  world.cleanup();
});

/** A sealed organization's own mark, written into every email of its records. */
const SEALED_MAIL = '@sealedmail.test';

/** An organization's folder with the shop's two tables and a short policy. */
function folder(name: string, seed: string, mail = '@example.com'): string {
  const data = shopData(seed, 160, 70);
  const path = join(world.root, 'orgs-picked', name);
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, 'customers.csv'), data.customersCsv.replaceAll('@example.com', mail));
  writeFileSync(join(path, 'orders.csv'), data.ordersCsv);
  writeFileSync(join(path, 'policy.md'), `# ${name} policy\n\nReturns within 30 days.\n`);
  return path;
}

function organizations(): DraftOrganization[] {
  return [
    { name: 'Acme Outfitters', folder: folder('acme', 'acme'), role: 'train' },
    { name: 'Birch Supply', folder: folder('birch', 'birch'), role: 'train' },
    { name: 'Cedar Goods', folder: folder('cedar', 'cedar', SEALED_MAIL), role: 'transfer' },
  ];
}

function textOf(request: MentorCompletionRequest): string {
  return [
    request.system,
    ...request.messages.map((message) => message.content),
    JSON.stringify(request.json),
  ].join('\n');
}

function filesUnder(root: string): string[] {
  return readdirSync(root).flatMap((name) => {
    const path = join(root, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

const DESCRIPTION = 'A desk that answers questions about each shop of our group';

describe('a field drafted from several organizations', () => {
  it('drafts the specification once and imports a job with each organization and its tasks', async () => {
    world.mentor.script = () => draft({ taskTypes: [EMAIL_TYPE, PENDING_TYPE] });
    const turn = await world.drafting.startField(DESCRIPTION, organizations(), TEACHER);
    const job = turn.draft;
    if (job === undefined) throw new Error(turn.message);

    // One call to the teacher, which read each taught organization's records under its name.
    expect(world.mentor.requests).toHaveLength(1);
    const opening = world.mentor.requests[0]?.messages[0]?.content ?? '';
    expect(opening).toContain('## Acme Outfitters\n\n### customers.csv (a table)\n70 rows');
    expect(opening).toContain('## Birch Supply\n\n### customers.csv (a table)\n70 rows');
    expect(opening).toContain('# acme policy');

    // The library keeps the taught organizations; the never-seen one is sealed with its tasks.
    expect(job.organizations?.map((org) => org.id)).toEqual(['acme-outfitters', 'birch-supply']);
    expect(job.taskTypes.map((type) => type.id)).toEqual(['email', 'pending']);
    const jobDir = world.paths.jobDir(job.id);
    expect(
      readFileSync(join(jobDir, 'orgs', 'acme-outfitters', 'data', 'customers.csv'), 'utf8'),
    ).toContain('@example.com');
    for (const file of filesUnder(jobDir)) {
      const text = readFileSync(file, 'utf8');
      expect(text, file).not.toMatch(/cedar/i);
      expect(text, file).not.toContain(SEALED_MAIL);
    }

    const visible = (
      await Promise.all(
        (['calibration', 'train', 'dev'] as const).map((split) => world.jobs.tasks(job.id, split)),
      )
    ).flat();
    const orgsOf = (tasks: readonly Task[]) => new Set(tasks.map((task) => task.org));
    expect(orgsOf(visible)).toEqual(new Set(['acme-outfitters', 'birch-supply']));
    for (const task of visible) expect(task.family.startsWith(`${task.org}:`)).toBe(true);

    const sealed = world.vault.openForLockedTest(
      job.id,
      await releaseMentor({ dispose: () => undefined }),
    );
    const unseen = sealed.filter((task) => task.org === 'cedar-goods');
    expect(unseen.length).toBeGreaterThan(10);
    expect(new Set(unseen.map((task) => task.type))).toEqual(new Set(['email', 'pending']));
    // Its tasks were made from its own records: the emails it is asked for are its own.
    expect(unseen.some((task) => JSON.stringify(task.expected).includes(SEALED_MAIL))).toBe(true);
    expect(world.vault.sealedOrganizations(job.id)).toEqual([
      { name: 'Cedar Goods', synthetic: false, files: 3 },
    ]);

    // What drafting left beside the job says where the tasks came from.
    const record = await world.jobs.drafting(job.id);
    expect(record).toMatchObject({ source: 'generated', cost: { calls: 1 } });
    expect(record?.types.map((type) => type.id)).toEqual(['email', 'pending']);
  });

  it('never sends the sealed organization, its name or its files, to the teacher', async () => {
    world.mentor.script = () => draft({ taskTypes: [EMAIL_TYPE, PENDING_TYPE] });
    const turn = await world.drafting.startField(DESCRIPTION, organizations(), TEACHER);
    expect(turn.draft).toBeDefined();
    const sent = world.mentor.requests.map(textOf).join('\n');
    expect(sent).not.toMatch(/cedar/i);
    expect(sent).not.toContain(SEALED_MAIL);
  });

  it('refuses before any call when a taught organization names the sealed one', async () => {
    const orgs = organizations();
    const acme = orgs[0]?.folder ?? '';
    writeFileSync(join(acme, 'policy.md'), '# Policy\n\nAsk Cedar Goods about returns.\n');
    const turn = await world.drafting.startField(DESCRIPTION, orgs, TEACHER);
    expect(turn.ended).toBe(true);
    expect(turn.message).toContain('kept for the final test');
    expect(world.mentor.requests).toHaveLength(0);
  });

  it('sends a rule back, since each organization keeps its own policy', async () => {
    const said = `${DESCRIPTION}. Orders carry a ten percent surcharge.`;
    const rule = {
      ...NO_TYPE,
      id: 'surcharged',
      label: 'Surcharged orders',
      description: 'Work out what an order comes to with its surcharge.',
      template: 'rule' as const,
      table: 'orders.csv',
      keyColumn: 'order_id',
      request: 'What does order {key} come to with its surcharge?',
      rule: wireRule({
        sources: [{ file: 'description', passage: 'Orders carry a ten percent surcharge.' }],
        steps: [
          step('amount', 'col', { column: 'amount', from: 'row' }),
          step('rate', 'num', { value: '1.1' }),
          step('priced', 'mul', { args: ['amount', 'rate'] }),
          step('total', 'round', { value: '0.01', mode: 'half_up', args: ['priced'] }),
        ],
        result: 'total',
      }),
    };
    world.mentor.script = (_request, call) =>
      call === 1 ? draft({ taskTypes: [EMAIL_TYPE, rule] }) : draft({ taskTypes: [EMAIL_TYPE] });
    const turn = await world.drafting.startField(said, organizations(), TEACHER);
    expect(turn.draft?.taskTypes.map((type) => type.id)).toEqual(['email']);
    expect(world.mentor.requests[1]?.messages.at(-1)?.content).toContain(
      'each organization keeps its own policy',
    );
  });

  it('asks for a taught organization and the same files in every folder', async () => {
    const orgs = organizations();
    await expect(
      world.drafting.startField(
        DESCRIPTION,
        orgs.map((org) => ({ ...org, role: 'transfer' as const })),
        TEACHER,
      ),
    ).rejects.toThrow('Mark at least one organization as taught on.');
    writeFileSync(join(orgs[2]?.folder ?? '', 'extra.csv'), 'a,b\n1,2\n');
    await expect(world.drafting.startField(DESCRIPTION, orgs, TEACHER)).rejects.toThrow(
      "Every organization needs the same files. Cedar Goods's folder also has extra.csv",
    );
    expect(world.mentor.requests).toHaveLength(0);
  });
});
