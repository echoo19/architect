import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { openEngineStore, SAMPLE_CONTENT } from '@architect/engine/testing';
import { ASK_TEAMMATE } from '@architect/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanUp, cli, keyboard, teamMachineWith, type TeamMachine } from './support';

afterEach(cleanUp);

const NEW_INVOICE = 'INV-4,C-2,5000,2026-12-05,false';
const SAMPLE_INVOICES = SAMPLE_CONTENT['invoices.csv'];

const asks = (request: string) => ({
  toolCalls: [{ name: ASK_TEAMMATE, arguments: { member: 'Assay desk', request } }],
});

const ADD_INVOICE = {
  toolCalls: [{ name: 'append', arguments: { path: 'data/invoices.csv', text: NEW_INVOICE } }],
};

const invoices = (machine: TeamMachine, which: 'graduate' | 'teammate') =>
  readFile(join(machine[which].workspaceDataDir, 'invoices.csv'), 'utf8');

describe('architect run --team (decision 100)', () => {
  it('opens every member, and the lead asks its teammate, whose steps show under the ask', async () => {
    const machine = await teamMachineWith([
      asks('How many invoices are on file?'),
      { toolCalls: [{ name: 'read', arguments: { path: 'data/invoices.csv' } }] },
      { text: 'Three are on file.\nANSWER: 3' },
      { text: 'Assay desk counts three.' },
    ]);
    const run = await cli(['run', '--team', 'Screening logistics'], {
      env: machine.env,
      stdin: 'How many invoices are on file there?\n',
    });
    expect(run.code).toBe(0);
    expect(run.stdout).toBe('Assay desk counts three.\n');
    expect(run.stderr).toContain('Screening logistics, led by Inventory desk:');
    expect(run.stderr).toContain('  Inventory desk, version 1, on muse-glimmer:30b (ollama).');
    expect(run.stderr).toContain('  Assay desk, version 1, on muse-glimmer:30b (ollama).');
    expect(run.stderr).toContain(
      '  asked Assay desk (Three are on file.)\n    read data/invoices.csv (3 rows)\n',
    );
    // The guard went up once, before any member loaded.
    expect(run.guards).toBe(1);
    // The teammate saw the lead's request and nothing of the conversation.
    const [, teammateTurn] = machine.model.chats();
    expect(teammateTurn?.messages.map((message) => message.role)).toEqual(['system', 'user']);
    expect(teammateTurn?.messages[1]?.content).toBe('How many invoices are on file?');
  });

  it('says how a teammate ended when it gave no answer, in the words the app uses', async () => {
    const reads = Array.from({ length: 4 }, () => ({
      toolCalls: [{ name: 'read', arguments: { path: 'data/policy.md' } }],
    }));
    const machine = await teamMachineWith([
      asks('Read the policy.'),
      ...reads,
      { text: 'Assay desk ran out of steps.' },
    ]);
    const run = await cli(['run', '--team', 'Screening logistics'], {
      env: machine.env,
      stdin: 'What does the policy say?\n',
    });
    expect(run.code).toBe(0);
    expect(run.stderr).toContain('  asked Assay desk (ran out of steps)\n    read data/policy.md');
  });

  it('finds a team by its id as well as by its name', async () => {
    const machine = await teamMachineWith([{ text: 'Nothing to ask.' }]);
    const run = await cli(['run', '--team', 'team_screening'], {
      env: machine.env,
      stdin: 'Hello.\n',
    });
    expect(run.code).toBe(0);
    expect(run.stdout).toBe('Nothing to ask.\n');
  });

  it("asks about a teammate's write under the teammate's name, and writes only its file", async () => {
    const machine = await teamMachineWith([
      asks('Add the invoice.'),
      ADD_INVOICE,
      { text: 'Added.\nANSWER: INV-4' },
      { text: 'Assay desk added it.' },
    ]);
    const keys = keyboard();
    const pending = cli(['run', '--team', 'screening-logistics'], {
      env: machine.env,
      stdin: keys,
      terminal: true,
      onStderr: (text) => {
        if (text.endsWith('[a]lways for Assay desk: ')) keys.write('y\n');
      },
    });
    keys.write('Add an invoice for Ruiz, Ben.\n');
    const watching = setInterval(() => {
      if (machine.model.chats().length === 4) {
        clearInterval(watching);
        setTimeout(() => keys.end(), 50);
      }
    }, 20);
    const run = await pending;
    clearInterval(watching);
    expect(run.code).toBe(0);
    expect(run.stderr).toContain('Assay desk: Add 1 row to data/invoices.csv:');
    expect(run.stderr).toContain('  + INV-4, C-2, 5000, 2026-12-05, false');
    expect(run.stdout).toContain('Assay desk added it.');
    expect(await invoices(machine, 'teammate')).toContain(NEW_INVOICE);
    expect(await invoices(machine, 'graduate')).toBe(SAMPLE_INVOICES);
  });

  it('names the lead on its own write, so every question in a team says whose change it is', async () => {
    const machine = await teamMachineWith([ADD_INVOICE, { text: 'Left it as it was.' }]);
    const keys = keyboard();
    const pending = cli(['run', '--team', 'Screening logistics'], {
      env: machine.env,
      stdin: keys,
      terminal: true,
      onStderr: (text) => {
        if (text.endsWith('[a]lways for Inventory desk: ')) keys.end();
      },
    });
    keys.write('Add an invoice for Ruiz, Ben.\n');
    const run = await pending;
    expect(run.stderr).toContain('Inventory desk: Add 1 row to data/invoices.csv:');
    expect(await invoices(machine, 'graduate')).toBe(SAMPLE_INVOICES);
  });

  it("fails closed on a teammate's write when nobody can answer, naming the teammate, with exit 3", async () => {
    const machine = await teamMachineWith([
      asks('Add the invoice.'),
      ADD_INVOICE,
      { text: 'never reached' },
    ]);
    const run = await cli(['run', '--team', 'Screening logistics'], {
      env: machine.env,
      stdin: 'Add an invoice for Ruiz, Ben.\n',
    });
    expect(run.code).toBe(3);
    expect(run.stderr).toContain(
      'Assay desk: Add 1 row to data/invoices.csv needs approval, and nobody could give it, so nothing was written.',
    );
    expect(run.stderr).toContain('allow writes for Assay desk in the app');
    expect(await invoices(machine, 'teammate')).toBe(SAMPLE_INVOICES);
    expect(machine.model.chats()).toHaveLength(2);
  });

  it('checks every member before any loads: a teammate without its folder stops the run with exit 3', async () => {
    const machine = await teamMachineWith([]);
    const store = openEngineStore(join(machine.dataDir, 'architect.db'));
    const installation = store.installations.get('grd_assay');
    if (!installation) throw new Error('no installation');
    store.installations.put({
      ...installation,
      grants: {
        ...installation.grants,
        resources: { ...installation.grants.resources, data: 'none' },
      },
    });
    store.close();
    const run = await cli(['run', '--team', 'Screening logistics'], {
      env: machine.env,
      stdin: 'Hello.\n',
    });
    expect(run.code).toBe(3);
    expect(run.stderr).toContain('Assay desk may not open data/');
    expect(run.guards).toBe(0);
    expect(machine.model.requests).toEqual([]);
  });

  it.each([
    [['run', '--team', 'Lab review'], 'There is no team called Lab review here.'],
    [['run', 'inventory-desk', '--team', 'Screening logistics'], 'run takes no agent with it'],
    [
      ['run', '--team', 'Screening logistics', '--input', 'request.json'],
      '--team holds a conversation',
    ],
    [['run'], 'architect run needs an argument'],
  ])('refuses %j with exit 2 before anything runs', async (argv, said) => {
    const machine = await teamMachineWith([]);
    const run = await cli(argv, { env: machine.env, stdin: 'Hello.\n' });
    expect(run.code).toBe(2);
    expect(run.stderr).toContain(said);
    expect(machine.model.requests).toEqual([]);
  });
});
