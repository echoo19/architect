import { useState } from 'react';
import type { GraduateSummary } from '@architect/shared';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  Tooltip,
} from '@architect/ui';
import { Building2, Check, ChevronDown } from 'lucide-react';
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
 * agent's records to it, as the settings' folder row does. Writes still ask as they did.
 */
export function OrganizationMenu({ agent }: { agent: GraduateSummary }) {
  const report = useVersionReport(agent);
  const installation = useInstallation(agent.id);
  const [choosing, setChoosing] = useState(false);
  const orgs = organizationsOf(report.data?.test.perOrg);
  if (orgs.length === 0 || installation.data === undefined) return null;
  const folder = installation.data.bindings['data'];
  const current = currentOrganization(orgs, folder);

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

  const label = `Organization: ${current?.name ?? 'not chosen'}`;
  return (
    <DropdownMenu>
      <Tooltip content={folder ? shortPath(folder) : `${agent.name}'s own copy`} side="bottom">
        <DropdownMenuTrigger asChild>
          <button type="button" className={trigger} disabled={choosing} aria-label={label}>
            <Building2 size={15} strokeWidth={1.8} aria-hidden />
            {current?.name ?? 'Choose an organization'}
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
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
