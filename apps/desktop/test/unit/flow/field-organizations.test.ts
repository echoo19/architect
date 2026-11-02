import type { DraftOrganization } from '@architect/shared';
import { describe, expect, it } from 'vitest';
import {
  fieldProblem,
  nameOf,
  nameProblem,
} from '../../../src/renderer/src/flow/describe/FieldOrganizations';

const org = (name: string, role: DraftOrganization['role'] = 'train'): DraftOrganization => ({
  name,
  folder: `D:/Group/${name || 'blank'}`,
  role,
});

describe("an organization's first name", () => {
  it('reads from its folder, and from the folder above a data folder', () => {
    expect(nameOf('D:/Group/acme_outfitters')).toBe('Acme outfitters');
    expect(nameOf('D:\\Group\\birch-supply\\')).toBe('Birch supply');
    expect(nameOf('D:/Group/acme/data')).toBe('Acme');
    expect(nameOf('D:\\Group\\birch\\Data')).toBe('Birch');
  });
});

describe('what keeps a field from being described', () => {
  it('marks a blank name and a name another organization has, as drafting tells them apart', () => {
    const field = [org('Acme Outfitters'), org(' acme outfitters ', 'transfer'), org('')];
    expect(nameProblem(field, 0)).toBe('Another organization has this name');
    expect(nameProblem(field, 1)).toBe('Another organization has this name');
    expect(nameProblem(field, 2)).toBe('Name it');
    expect(fieldProblem(field)).toBe('Name each organization.');
    expect(fieldProblem(field.slice(0, 2))).toBe('Give each organization its own name.');
  });

  it('needs a folder and one organization taught on', () => {
    expect(fieldProblem([])).toBe("Add each organization's folder.");
    expect(fieldProblem([org('Acme', 'transfer')])).toBe(
      'Mark at least one organization as taught on.',
    );
    expect(fieldProblem([org('Acme'), org('Birch', 'transfer')])).toBeNull();
  });
});
