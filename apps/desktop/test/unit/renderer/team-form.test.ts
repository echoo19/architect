import type { GraduateSummary } from '@architect/shared';
import { describe, expect, it } from 'vitest';
import {
  defaultRole,
  MAX_TEAMMATES,
  membersOf,
  ROLE_CHARS,
  teamAgents,
  teamInput,
  teamProblem,
} from '../../../src/renderer/src/models/team-form';

const agent = (id: string, name: string, activeVersion: number | null = 1) =>
  ({ id, name, activeVersion }) as GraduateSummary;

const LEAD = agent('grd_lead', 'Inventory desk');
const MATE = agent('grd_mate', 'Assay desk');
const DRAFT = agent('grd_draft', 'Sweep desk', null);

describe('the team form', () => {
  it('lets a lead ask up to three teammates, of the agents that can run', () => {
    expect(MAX_TEAMMATES).toBe(3);
    expect(teamAgents([LEAD, MATE, DRAFT])).toEqual([LEAD, MATE]);
  });

  it("starts a role from the contract's summary, cut to fit at a word", () => {
    expect(ROLE_CHARS).toBe(120);
    expect(defaultRole(undefined)).toBe('');
    expect(defaultRole("  Reads a screening lab's plate exports.  ")).toBe(
      "Reads a screening lab's plate exports.",
    );
    const long = defaultRole(`${'Reads plates and calls hits, '.repeat(6)}then reports.`);
    expect(long.length).toBeLessThanOrEqual(120);
    expect(long.endsWith('…')).toBe(true);
    expect(long).not.toMatch(/[ ,]…$/);
  });

  it('saves the lead first, and a role only where the person wrote their own', () => {
    const defaults = { grd_mate: "Reads a screening lab's plate exports." };
    expect(
      teamInput(' Screening logistics ', LEAD.id, [{ graduateId: MATE.id }], defaults),
    ).toEqual({
      name: 'Screening logistics',
      members: [{ graduateId: LEAD.id }, { graduateId: MATE.id }],
    });
    expect(
      teamInput(
        'Screening logistics',
        LEAD.id,
        [{ graduateId: MATE.id, role: defaults.grd_mate }],
        defaults,
      ).members[1],
    ).toEqual({ graduateId: MATE.id });
    expect(
      teamInput(
        'Screening logistics',
        LEAD.id,
        [{ graduateId: MATE.id, role: ' Which compounds need a re-test ' }],
        defaults,
      ).members[1],
    ).toEqual({ graduateId: MATE.id, role: 'Which compounds need a re-test' });
  });

  it("says what a team still needs before it's saved", () => {
    const graduates = [LEAD, MATE, agent('grd_twin', 'Assay desk')];
    const mate = [{ graduateId: MATE.id }];
    expect(teamProblem(' ', LEAD.id, mate, graduates)).toBe('Name the team');
    expect(teamProblem('Lab', undefined, mate, graduates)).toBe('Choose a lead');
    expect(teamProblem('Lab', LEAD.id, [], graduates)).toBe('Choose a teammate');
    expect(teamProblem('Lab', LEAD.id, [...mate, { graduateId: 'grd_twin' }], graduates)).toBe(
      'Two agents are named Assay desk; rename one first',
    );
    expect(teamProblem('Lab', LEAD.id, mate, graduates)).toBeNull();
    expect(teamProblem(' lab ', LEAD.id, mate, graduates, ['Lab', 'Field'])).toBe(
      'Another team is named lab',
    );
    expect(teamProblem('Lab', LEAD.id, mate, graduates, ['Field'])).toBeNull();
  });

  it("finds a saved team's lead and teammates", () => {
    const team = {
      id: 'team_lab',
      name: 'Screening logistics',
      members: [{ graduateId: LEAD.id }, { graduateId: MATE.id }],
      createdAt: '2026-10-31T09:00:00.000Z',
      updatedAt: '2026-10-31T09:00:00.000Z',
    };
    expect(membersOf(team, [MATE, LEAD])).toEqual({ lead: LEAD, teammates: [MATE] });
  });
});
