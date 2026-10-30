import type { OrgTypeResult } from '@architect/shared';
import { describe, expect, it } from 'vitest';
import {
  currentOrganization,
  organizationsOf,
  orgOfFolder,
} from '../../../src/renderer/src/workspace/organizations';

function result(org: string, name: string, seen: boolean): OrgTypeResult {
  return { type: 'a', label: 'A', org, orgName: name, seen, synthetic: true, pass: 1, total: 1 };
}

const PER_ORG = [
  result('north', 'North Academy', true),
  result('south', 'South Academy', true),
  result('east', 'East Academy', false),
  { ...result('north', 'North Academy', true), type: 'b' },
];

describe('the organization an agent works on', () => {
  it('lists each organization once, and none for a one-organization agent', () => {
    expect(organizationsOf(PER_ORG).map((org) => org.org)).toEqual(['north', 'south', 'east']);
    expect(organizationsOf([result('north', 'North Academy', true)])).toEqual([]);
    expect(organizationsOf(undefined)).toEqual([]);
  });

  it('reads the organization from its folder, on either kind of path', () => {
    expect(orgOfFolder('C:\\jobs\\academy\\orgs\\east\\data')).toBe('east');
    expect(orgOfFolder('/home/dana/academy/orgs/south/data/')).toBe('south');
    expect(orgOfFolder('/home/dana/records')).toBeNull();
  });

  it('is the first trained one while unbound, the bound one after, or the folder by its name', () => {
    const orgs = organizationsOf(PER_ORG);
    expect(currentOrganization(orgs, undefined)).toEqual({ org: 'north', name: 'North Academy' });
    expect(currentOrganization(orgs, '/a/orgs/east/data')).toEqual({
      org: 'east',
      name: 'East Academy',
    });
    expect(currentOrganization(orgs, '/a/academy-real')).toEqual({
      org: null,
      name: 'academy-real',
    });
  });
});
