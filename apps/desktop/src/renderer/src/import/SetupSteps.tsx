import type {
  Installation,
  PackageManifest,
  PackageResource,
  PermissionMode,
  ResourceGrant,
} from '@architect/shared';
import {
  Button,
  Heading,
  Segmented,
  SettingsRow,
  SettingsValue,
  StatusMark,
  type MarkState,
} from '@architect/ui';
import { FolderOpen } from 'lucide-react';
import { architect } from '../api/client';
import { folderName } from '../install/folders';
import { GRANT_LABELS, stepsNeedingAttention } from '../install/labels';
import { shortPath } from '../lib/format';
import { attempt } from '../lib/notify';
import { currentPlatform, deviceInSentence } from '../lib/platform';
import {
  WRITE_MODE_LABELS,
  WRITE_MODE_MEANINGS,
  WRITE_MODES,
  WRITE_SETTING,
} from '../workspace/labels';

/** What a folder is for: the files it should hold, or what the job keeps in it. */
function folderInfo(resource: PackageResource, manifest: PackageManifest): string {
  if (resource.name === 'output') {
    return manifest.contract.outputs.folder?.description ?? 'Where it saves new files';
  }
  return resource.description;
}

/**
 * The folders it needs that it can't use yet: not chosen, or, once `grants` are given, not
 * allowed. Installing anyway leaves it needing attention, with the way to finish in its result.
 */
export function foldersNotSetUp(
  manifest: PackageManifest,
  bindings: Record<string, string>,
  grants?: Record<string, ResourceGrant>,
): PackageResource[] {
  return manifest.resources.filter(
    (resource) =>
      resource.required &&
      ((bindings[resource.name] === undefined && !resource.bundled) ||
        (grants !== undefined && (grants[resource.name] ?? 'none') === 'none')),
  );
}

/** Beside the way on, the folders it can't use yet: "Its records folder isn't set up yet". */
export function NotSetUp({ resources }: { resources: readonly PackageResource[] }) {
  const [first] = resources;
  if (first === undefined) return null;
  return (
    <span className="text-small text-fg">
      {resources.length === 1
        ? `Its ${folderName(first).toLowerCase()} isn't set up yet`
        : `${resources.length} of its folders aren't set up yet`}
    </span>
  );
}

/**
 * The import steps passed that left something undone, so the pills mark them instead of ticking
 * them: a folder not chosen, which has no access given either, or one not allowed yet. Once it is
 * installed, its checks say, since a folder can be chosen and allowed after.
 */
export function stepsLeftUndone(
  manifest: PackageManifest,
  bindings: Record<string, string>,
  grants: Record<string, ResourceGrant>,
  installation: Pick<Installation, 'checks'> | undefined,
): ('Folders' | 'Permissions')[] {
  if (installation) {
    const marked = stepsNeedingAttention(installation);
    return marked.includes('Folders') ? ['Folders', 'Permissions'] : marked;
  }
  if (foldersNotSetUp(manifest, bindings).length > 0) return ['Folders', 'Permissions'];
  return foldersNotSetUp(manifest, bindings, grants).length > 0 ? ['Permissions'] : [];
}

/** Asks for the folder a resource names, and binds it once one is chosen. */
function chooseFolder(resource: PackageResource, onBind: (name: string, folder: string) => void) {
  void attempt("Couldn't choose that folder", async () => {
    const [folder] = await architect().files.pick({
      title: `Choose the ${folderName(resource).toLowerCase()}`,
      directory: true,
    });
    if (folder) onBind(resource.name, folder);
  });
}

/** Step two: where on this computer the files are, for each folder the agent works in. */
export function FoldersStep({
  manifest,
  bindings,
  onBind,
}: {
  manifest: PackageManifest;
  bindings: Record<string, string>;
  onBind: (name: string, folder: string) => void;
}) {
  return (
    <>
      <Heading as="h1" size="display-sm">
        Where are its files?
      </Heading>
      <ul aria-label="Folders" className="m-0 flex list-none flex-col p-0">
        {manifest.resources.map((resource) => {
          const folder = bindings[resource.name];
          const state: MarkState =
            folder !== undefined || resource.bundled
              ? 'ok'
              : resource.required
                ? 'attention'
                : 'off';
          return (
            <li key={resource.name} aria-label={folderName(resource)}>
              <SettingsRow
                icon={<StatusMark state={state} />}
                label={folderName(resource)}
                meta={
                  resource.files.length > 0
                    ? resource.files.map((file) => file.name).join(', ')
                    : undefined
                }
                info={folderInfo(resource, manifest)}
              >
                <div className="flex items-center gap-3">
                  {folder !== undefined ? (
                    <span className="font-mono text-small text-fg">{shortPath(folder)}</span>
                  ) : (
                    <SettingsValue>
                      {resource.bundled
                        ? "The package's copy"
                        : resource.required
                          ? 'Not chosen'
                          : 'Optional'}
                    </SettingsValue>
                  )}
                  <Button size="xs" onClick={() => chooseFolder(resource, onBind)}>
                    <FolderOpen size={14} strokeWidth={1.7} aria-hidden />
                    {folder === undefined ? 'Choose' : 'Change'}
                  </Button>
                </div>
              </SettingsRow>
            </li>
          );
        })}
      </ul>
    </>
  );
}

/** Each access level up to what the package asks for, and no further. */
function levelsUpTo(asked: PackageResource['access']): { value: ResourceGrant; label: string }[] {
  const levels: ResourceGrant[] =
    asked === 'read' ? ['none', 'read'] : ['none', 'read', 'read_write'];
  return levels.map((value) => ({ value, label: GRANT_LABELS[value] }));
}

/** The small tools its setup brings, by name. */
function toolNames(manifest: PackageManifest): string[] {
  const prefix = `${manifest.harness.path}/tools/`;
  return manifest.integrity.files
    .map((entry) => entry.path)
    .filter((path) => path.startsWith(prefix) && path.endsWith('.js'))
    .map((path) => path.slice(prefix.length, -'.js'.length));
}

const WRITE_CHOICES = WRITE_MODES.map((value) => ({ value, label: WRITE_MODE_LABELS[value] }));

/**
 * Step three: what the package asks to do, and what this computer grants. Nothing it asks for is
 * granted until it is chosen here. A folder left unchosen has nothing to grant, so it can be
 * chosen here, and its access given in the same place.
 */
export function PermissionsStep({
  manifest,
  bindings,
  grants,
  writes,
  onBind,
  onGrant,
  onWrites,
}: {
  manifest: PackageManifest;
  bindings: Record<string, string>;
  grants: Record<string, ResourceGrant>;
  writes: PermissionMode;
  onBind: (name: string, folder: string) => void;
  onGrant: (name: string, grant: ResourceGrant) => void;
  onWrites: (mode: PermissionMode) => void;
}) {
  const tools = toolNames(manifest);
  // Saving only matters once a folder it may change has been allowed, so the choice comes then.
  const changes = manifest.resources.some((resource) => grants[resource.name] === 'read_write');
  return (
    <>
      <Heading as="h1" size="display-sm">
        What may it do?
      </Heading>
      <div className="flex flex-col">
        {manifest.resources.map((resource) => (
          <SettingsRow
            key={resource.name}
            label={folderName(resource)}
            meta={
              resource.access === 'read' ? 'It needs to read it' : 'It needs to read and change it'
            }
          >
            {bindings[resource.name] === undefined && !resource.bundled ? (
              <div className="flex items-center gap-3">
                <SettingsValue>
                  {resource.required ? 'No folder chosen' : 'Optional, none chosen'}
                </SettingsValue>
                <Button size="xs" onClick={() => chooseFolder(resource, onBind)}>
                  <FolderOpen size={14} strokeWidth={1.7} aria-hidden />
                  Choose
                </Button>
              </div>
            ) : (
              <Segmented
                aria-label={`Access to the ${folderName(resource).toLowerCase()}`}
                options={levelsUpTo(resource.access)}
                value={grants[resource.name] ?? 'none'}
                onValueChange={(grant) => onGrant(resource.name, grant)}
              />
            )}
          </SettingsRow>
        ))}
        {changes && (
          <SettingsRow label={WRITE_SETTING} info={WRITE_MODE_MEANINGS[writes]}>
            <Segmented
              aria-label={WRITE_SETTING}
              options={WRITE_CHOICES}
              value={writes}
              onValueChange={onWrites}
            />
          </SettingsRow>
        )}
        <SettingsRow
          label="Internet access"
          info={`It only talks to the model on ${deviceInSentence(currentPlatform())}.`}
        >
          <SettingsValue>Never, by design</SettingsValue>
        </SettingsRow>
        {tools.length > 0 && (
          <SettingsRow label="Small tools it brings" meta="They run in isolation">
            <span className="font-mono text-small text-fg">{tools.join(', ')}</span>
          </SettingsRow>
        )}
      </div>
    </>
  );
}
