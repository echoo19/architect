import type { DraftOrganization } from '@architect/shared';
import { Button, Card, CardRow, IconButton, Input, Segmented } from '@architect/ui';
import { Building2, FolderPlus, Lock, X } from 'lucide-react';
import { flowApi } from '../../api/client';
import { Quiet, Tile } from '../../fields/parts';
import { attempt } from '../../lib/notify';
import { fileName } from '../format';

type Role = DraftOrganization['role'];

const ROLES = [
  { value: 'train', label: 'Taught on' },
  { value: 'transfer', label: 'Never seen' },
] as const satisfies readonly { value: Role; label: string }[];

/** A folder's name as an organization's first name: "acme_outfitters" reads "Acme outfitters". */
function nameOf(folder: string): string {
  const words = fileName(folder).replace(/[_-]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Why the field can't be described yet, or null when it can. */
export function fieldProblem(organizations: readonly DraftOrganization[]): string | null {
  if (organizations.length === 0) return "Add each organization's folder.";
  if (organizations.some((org) => org.name.trim() === '')) return 'Name each organization.';
  if (!organizations.some((org) => org.role === 'train')) {
    return 'Mark at least one organization as taught on.';
  }
  return null;
}

/**
 * The organizations of a field, each a folder with its files: named, and taught on or never seen.
 * The teacher reads only the taught ones' files; the others are sealed for the final test.
 */
export function FieldOrganizations({
  organizations,
  onChange,
  onLeave,
}: {
  organizations: DraftOrganization[];
  onChange: (organizations: DraftOrganization[]) => void;
  onLeave: () => void;
}) {
  const add = async () => {
    const picked = await attempt("Couldn't open the folder picker", () =>
      flowApi.pickFiles({ title: "Choose an organization's folder", directory: true }),
    );
    const folder = picked?.[0];
    if (!folder || organizations.some((org) => org.folder === folder)) return;
    // The first is taught on; after that, the person says which.
    const role: Role = organizations.length === 0 ? 'train' : 'transfer';
    onChange([...organizations, { name: nameOf(folder), folder, role }]);
  };
  const change = (index: number, patch: Partial<DraftOrganization>) =>
    onChange(organizations.map((org, at) => (at === index ? { ...org, ...patch } : org)));

  return (
    <Card
      title="Organizations"
      flush
      action={
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" onClick={onLeave}>
            One job instead
          </Button>
          <Button size="sm" onClick={() => void add()}>
            <FolderPlus size={15} strokeWidth={1.7} aria-hidden />
            Add organization
          </Button>
        </div>
      }
    >
      {organizations.length === 0 ? (
        <Quiet>Add a folder for each organization, with the same files in each.</Quiet>
      ) : (
        organizations.map((org, index) => (
          <CardRow
            key={org.folder}
            icon={
              <Tile>
                {org.role === 'train' ? (
                  <Building2 strokeWidth={1.8} aria-hidden />
                ) : (
                  <Lock strokeWidth={1.8} aria-hidden />
                )}
              </Tile>
            }
            title={
              <Input
                aria-label="Organization name"
                value={org.name}
                onChange={(event) => change(index, { name: event.target.value })}
                className="h-8 bg-transparent px-2 shadow-none hover:bg-field focus-visible:bg-field focus-visible:shadow-edge-strong"
              />
            }
            detail={<span className="px-2">{fileName(org.folder)}</span>}
            end={
              <>
                <Segmented
                  aria-label={`What ${org.name || 'this organization'} is to the agent`}
                  value={org.role}
                  onValueChange={(role) => change(index, { role })}
                  options={ROLES}
                />
                <IconButton
                  label={`Remove ${org.name || 'this organization'}`}
                  size="sm"
                  onClick={() => onChange(organizations.filter((_, at) => at !== index))}
                >
                  <X size={15} strokeWidth={1.7} aria-hidden />
                </IconButton>
              </>
            }
          />
        ))
      )}
    </Card>
  );
}
