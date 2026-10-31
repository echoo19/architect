import { useState } from 'react';
import { organizationNoun, type GraduateSummary } from '@architect/shared';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Tooltip,
} from '@architect/ui';
import { Building2, Check, ChevronDown, FolderOpen } from 'lucide-react';
import { architect } from '../api/client';
import {
  graduateKeys,
  graduatesApi,
  refreshAgent,
  useInstallation,
  useVersionReport,
} from '../api/graduates';
import { setQueryData } from '../api/query';
import { shortPath } from '../lib/format';
import { attempt } from '../lib/notify';
import {
  currentOrganization,
  folderProblem,
  organizationsOf,
  type AgentOrganization,
} from './organizations';

const trigger =
  'flex h-8 items-center gap-1.5 rounded-full px-3 text-small font-medium text-fg transition-colors duration-150 hover:bg-hover disabled:opacity-60 [&_svg]:shrink-0';

/**
 * Which organization's records an agent from a several-organization job works on, and a way to
 * move it to another: choosing one asks for that organization's records folder and binds the
 * agent's records to it, as the settings' folder row does. "Another <organization>" binds a folder of
 * the person's own records once it holds the files and columns the agent was trained with; the
 * header then says the agent wasn't tested there, since no report number applies to it. Writes
 * still ask as they did.
 */
export function OrganizationMenu({ agent }: { agent: GraduateSummary }) {
  const report = useVersionReport(agent);
  const installation = useInstallation(agent.id);
  const [choosing, setChoosing] = useState(false);
  const orgs = organizationsOf(report.data?.test.perOrg);
  if (orgs.length === 0 || installation.data === undefined) return null;
  const folder = installation.data.bindings['data'];
  const current = currentOrganization(orgs, folder);
  const noun = organizationNoun(report.data ?? {});

  const choose = async (org: AgentOrganization) => {
    setChoosing(true);
    const next = await attempt(`Couldn't move ${agent.name} to ${org.name}`, async () => {
      const [picked] = await architect().files.pick({
        title: `Choose ${org.name}'s records folder`,
        directory: true,
      });
      if (!picked) return null;
      const problem = folderProblem(orgs, org, picked);
      if (problem !== null) throw new Error(problem);
      const bound = await graduatesApi.bind(agent.id, { bindings: { data: picked } });
      await refreshAgent(agent.id);
      return bound;
    });
    setChoosing(false);
    if (next) setQueryData(graduateKeys.installation(agent.id), next);
  };

  const own = folder !== undefined && current?.org === null;
  const label = `Organization: ${current?.name ?? 'not chosen'}${own ? `, not tested at this ${noun}` : ''}`;
  const chooseOwn = async () => {
    setChoosing(true);
    const next = await attempt(`Couldn't move ${agent.name} to another ${noun}`, async () => {
      const [picked] = await architect().files.pick({
        title: `Choose the folder that holds your ${noun}’s records`,
        directory: true,
      });
      if (!picked) return null;
      const fit = await graduatesApi.checkFolder(agent.id, 'data', picked);
      if (fit.problems.length > 0) {
        throw new Error(`${agent.name} can't work from that folder. ${fit.problems.join(' ')}`);
      }
      const bound = await graduatesApi.bind(agent.id, { bindings: { data: picked } });
      await refreshAgent(agent.id);
      return bound;
    });
    setChoosing(false);
    if (next) setQueryData(graduateKeys.installation(agent.id), next);
  };

  return (
    <DropdownMenu>
      <Tooltip content={folder ? shortPath(folder) : `${agent.name}'s own copy`} side="bottom">
        <DropdownMenuTrigger asChild>
          <button type="button" className={trigger} disabled={choosing} aria-label={label}>
            <Building2 size={15} strokeWidth={1.8} aria-hidden />
            {current?.name ?? 'Choose an organization'}
            {own && <span className="font-normal text-fg-dim">{`Not tested at this ${noun}`}</span>}
            <ChevronDown size={14} strokeWidth={1.8} aria-hidden />
          </button>
        </DropdownMenuTrigger>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel>Organization</DropdownMenuLabel>
        {orgs.map((org) => (
          <DropdownMenuItem
            key={org.org}
            onSelect={() => void choose(org)}
            icon={<Building2 strokeWidth={1.8} aria-hidden />}
            shortcut={
              org.org === current?.org ? <Check strokeWidth={2} aria-label="Current" /> : null
            }
          >
            {org.name}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => void chooseOwn()}
          icon={<FolderOpen strokeWidth={1.8} aria-hidden />}
          shortcut={own ? <Check strokeWidth={2} aria-label="Current" /> : null}
        >
          {`Another ${noun}…`}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
