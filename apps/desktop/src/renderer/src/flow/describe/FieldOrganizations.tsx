import { useState } from 'react';
import { slugify, type DraftOrganization } from '@architect/shared';
import {
  Button,
  Card,
  CardRow,
  Collapse,
  IconButton,
  Input,
  RowIcon,
  Segmented,
} from '@architect/ui';
import { Building2, CircleAlert, FolderPlus, Lock, X } from 'lucide-react';
import { flowApi } from '../../api/client';
import { EmptyRow } from '../../fields/parts';
import { attempt } from '../../lib/notify';
import { fileName } from '../format';

type Role = DraftOrganization['role'];

const ROLES = [
  { value: 'train', label: 'Taught on' },
  { value: 'transfer', label: 'Never seen' },
] as const satisfies readonly { value: Role; label: string }[];

/** What each choice does with an organization's files, said under its name. */
const ROLE_MEANS: Record<Role, string> = {
  train: 'Its files are taught on',
  transfer: 'Sealed for the final test',
};

/**
 * A folder's name as an organization's first name: "acme_outfitters" reads "Acme outfitters". A
 * folder called data is named after the folder it is in, so "acme/data" reads "Acme".
 */
export function nameOf(folder: string): string {
  const parts = folder.split(/[\\/]/).filter(Boolean);
  const own = parts.at(-1) ?? folder;
  const named = own.toLowerCase() === 'data' && parts.length > 1 ? (parts.at(-2) ?? own) : own;
  const words = named.replace(/[_-]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * What is wrong with one organization's name, or null: none, or another's, told apart as drafting
 * tells them apart (by their ids, so "Acme" and "acme" are the same name).
 */
export function nameProblem(
  organizations: readonly DraftOrganization[],
  index: number,
): string | null {
  const name = organizations[index]?.name.trim() ?? '';
  if (name === '') return 'Name it';
  const twice = organizations.some(
    (org, at) =>
      at !== index && org.name.trim() !== '' && slugify(org.name.trim()) === slugify(name),
  );
  return twice ? 'Another organization has this name' : null;
}

/** Why the field can't be described yet, or null when it can. */
export function fieldProblem(organizations: readonly DraftOrganization[]): string | null {
  if (organizations.length === 0) return "Add each organization's folder.";
  if (organizations.some((org) => org.name.trim() === '')) return 'Name each organization.';
  if (organizations.some((_, index) => nameProblem(organizations, index) !== null)) {
    return 'Give each organization its own name.';
  }
  if (!organizations.some((org) => org.role === 'train')) {
    return 'Mark at least one organization as taught on.';
  }
  return null;
}

/**
 * The organizations of a field, each a folder with its files: named, and taught on or never seen.
 * The teacher reads only the taught ones' files; the others are sealed for the final test. A
 * folder is checked as it is added, and what keeps the field from being described is said under
 * the rows, before it is sent.
 */
export function FieldOrganizations({
  organizations,
  onChange,
  onLeave,
  problem,
}: {
  organizations: DraftOrganization[];
  onChange: (organizations: DraftOrganization[]) => void;
  onLeave: () => void;
  /** What keeps the field from being described, once it is worth saying. */
  problem: string | null;
}) {
  // Why the last folder chosen wasn't added, until the rows change.
  const [refused, setRefused] = useState<string | null>(null);
  const update = (next: DraftOrganization[]) => {
    setRefused(null);
    onChange(next);
  };
  const add = async () => {
    const picked = await attempt("Couldn't open the folder picker", () =>
      flowApi.pickFiles({ title: "Choose an organization's folder", directory: true }),
    );
    const folder = picked?.[0];
    if (!folder) return;
    const already = organizations.find((org) => org.folder === folder);
    if (already) {
      setRefused(`${fileName(folder)} is already added, as ${already.name || 'an organization'}.`);
      return;
    }
    const [unreadable] = (await attempt("Couldn't check the folder", () =>
      flowApi.checkFiles([folder]),
    )) ?? [null];
    if (unreadable) {
      setRefused(unreadable);
      return;
    }
    // The first is taught on; after that, never seen until the person says otherwise, which the
    // row says under its name.
    const role: Role = organizations.length === 0 ? 'train' : 'transfer';
    update([...organizations, { name: nameOf(folder), folder, role }]);
  };
  // A name to fix is said on its row, so it isn't said again under the rows.
  const rowsSay = organizations.some((_, index) => nameProblem(organizations, index) !== null);
  const notes = [refused, rowsSay ? null : problem].filter((note): note is string => note !== null);
  const change = (index: number, patch: Partial<DraftOrganization>) =>
    update(organizations.map((org, at) => (at === index ? { ...org, ...patch } : org)));

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
        <EmptyRow title="Add a folder for each organization, with the same files in each" />
      ) : (
        organizations.map((org, index) => {
          const misnamed = nameProblem(organizations, index);
          return (
            <CardRow
              key={org.folder}
              icon={
                <RowIcon>
                  {org.role === 'train' ? (
                    <Building2 strokeWidth={1.8} aria-hidden />
                  ) : (
                    <Lock strokeWidth={1.8} aria-hidden />
                  )}
                </RowIcon>
              }
              title={
                <Input
                  aria-label="Organization name"
                  aria-invalid={misnamed !== null || undefined}
                  value={org.name}
                  onChange={(event) => change(index, { name: event.target.value })}
                  className="h-8 bg-transparent px-2 shadow-none hover:bg-field focus-visible:bg-field focus-visible:shadow-edge-strong"
                />
              }
              detail={
                <span className="flex flex-wrap gap-x-3 px-2">
                  {misnamed === null ? (
                    <>
                      <span>{fileName(org.folder)}</span>
                      <span>{ROLE_MEANS[org.role]}</span>
                    </>
                  ) : (
                    <span className="text-danger">{misnamed}</span>
                  )}
                </span>
              }
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
                    onClick={() => update(organizations.filter((_, at) => at !== index))}
                  >
                    <X size={15} strokeWidth={1.7} aria-hidden />
                  </IconButton>
                </>
              }
            />
          );
        })
      )}
      <Collapse open={notes.length > 0}>
        <div role="alert" className="flex flex-col gap-1.5 border-t border-line px-6 py-4">
          {notes.map((note) => (
            <p key={note} className="m-0 flex gap-2.5 text-small text-pretty">
              <CircleAlert
                size={15}
                strokeWidth={1.8}
                className="mt-0.5 shrink-0 text-danger"
                aria-hidden
              />
              {note}
            </p>
          ))}
        </div>
      </Collapse>
    </Card>
  );
}
