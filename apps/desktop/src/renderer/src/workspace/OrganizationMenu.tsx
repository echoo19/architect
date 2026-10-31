import { useCallback, useEffect, useState } from 'react';
import { organizationNoun, type GraduateSummary } from '@architect/shared';
import {
  AgentAvatar,
  cn,
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
 * Which organization's records an agent works on, and the two ways to move it: to another of its
 * job's organizations, which asks for that organization's records folder, or to a folder of the
 * person's own records that holds the files and columns it was trained with. Null for an agent
 * from a job with one organization, or until its report and installation have loaded.
 */
function useOrganization(agent: GraduateSummary) {
  const report = useVersionReport(agent);
  const installation = useInstallation(agent.id);
  const [choosing, setChoosing] = useState(false);
  const orgs = organizationsOf(report.data?.test.perOrg);
  if (orgs.length === 0 || installation.data === undefined) return null;
  const folder = installation.data.bindings['data'];
  const current = currentOrganization(orgs, folder);
  const noun = organizationNoun(report.data ?? {});
  const own = folder !== undefined && current?.org === null;

  const bindTo = async (title: string, pick: () => Promise<string | undefined>) => {
    setChoosing(true);
    const next = await attempt(title, async () => {
      const picked = await pick();
      if (!picked) return null;
      const bound = await graduatesApi.bind(agent.id, { bindings: { data: picked } });
      await refreshAgent(agent.id);
      return bound;
    });
    setChoosing(false);
    if (next) setQueryData(graduateKeys.installation(agent.id), next);
  };
  const choose = (org: AgentOrganization) =>
    bindTo(`Couldn't move ${agent.name} to ${org.name}`, async () => {
      const [picked] = await architect().files.pick({
        title: `Choose ${org.name}'s records folder`,
        directory: true,
      });
      if (!picked) return undefined;
      const problem = folderProblem(orgs, org, picked);
      if (problem !== null) throw new Error(problem);
      return picked;
    });
  const chooseOwn = () =>
    bindTo(`Couldn't move ${agent.name} to another ${noun}`, async () => {
      const [picked] = await architect().files.pick({
        title: `Choose the folder that holds your ${noun}’s records`,
        directory: true,
      });
      if (!picked) return undefined;
      const fit = await graduatesApi.checkFolder(agent.id, 'data', picked);
      if (fit.problems.length > 0) {
        throw new Error(`${agent.name} can't work from that folder. ${fit.problems.join(' ')}`);
      }
      return picked;
    });
  return {
    orgs,
    current,
    noun,
    own,
    choosing,
    choose,
    chooseOwn,
    where: folder ? shortPath(folder) : `${agent.name}'s own copy`,
  };
}

type Organization = NonNullable<ReturnType<typeof useOrganization>>;

/** One agent's choices: each organization of its job, then a folder of the person's own. */
function OrganizationItems({ organization }: { organization: Organization }) {
  const { orgs, current, own, noun, choose, chooseOwn } = organization;
  return (
    <>
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
    </>
  );
}

/**
 * Which organization's records an agent from a several-organization job works on, and a way to
 * move it to another: choosing one asks for that organization's records folder and binds the
 * agent's records to it, as the settings' folder row does. "Another <organization>" binds a folder
 * of the person's own records once it holds the files and columns the agent was trained with; the
 * header then says the agent wasn't tested there, since no report number applies to it. Writes
 * still ask as they did. In a team chat whose agents work at different organizations, one menu
 * stands for each (`named`): it leads with the agent's avatar and says whose records it is.
 */
export function OrganizationMenu({
  agent,
  named = false,
}: {
  agent: GraduateSummary;
  named?: boolean;
}) {
  const organization = useOrganization(agent);
  if (!organization) return null;
  const { current, own, noun, choosing, where } = organization;
  const whose = named ? `${agent.name}'s organization` : 'Organization';
  const label = `${whose}: ${current?.name ?? 'not chosen'}${own ? `, not tested at this ${noun}` : ''}`;

  return (
    <DropdownMenu>
      <Tooltip content={named ? `${agent.name} · ${where}` : where} side="bottom">
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={cn(trigger, named && 'pl-1')}
            disabled={choosing}
            aria-label={label}
          >
            {named ? (
              <AgentAvatar name={agent.name} />
            ) : (
              <Building2 size={15} strokeWidth={1.8} aria-hidden />
            )}
            {current?.name ?? 'Choose an organization'}
            {own && <span className="font-normal text-fg-dim">{`Not tested at this ${noun}`}</span>}
            <ChevronDown size={14} strokeWidth={1.8} aria-hidden />
          </button>
        </DropdownMenuTrigger>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel>{whose}</DropdownMenuLabel>
        <OrganizationItems organization={organization} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Where an agent works, as a team's header compares its agents: the organization, or null. */
interface Place {
  key: string;
  name: string;
}

/** Reads one agent's organization and says it to the team's menu; it shows nothing itself. */
function PlaceOf({
  agent,
  onPlace,
}: {
  agent: GraduateSummary;
  onPlace: (graduateId: string, place: Place | null) => void;
}) {
  const organization = useOrganization(agent);
  const current = organization?.current;
  const key = current ? (current.org ?? `folder:${current.name}`) : null;
  const name = current?.name ?? null;
  useEffect(() => {
    onPlace(agent.id, key === null || name === null ? null : { key, name });
  }, [agent.id, key, name, onPlace]);
  return null;
}

/** One agent's group in the team's shared menu: its name, then its own choices. */
function MemberItems({ agent, last }: { agent: GraduateSummary; last: boolean }) {
  const organization = useOrganization(agent);
  if (!organization) return null;
  return (
    <>
      <DropdownMenuLabel>
        <span className="flex items-center gap-2">
          <AgentAvatar name={agent.name} className="size-5" />
          {agent.name}
        </span>
      </DropdownMenuLabel>
      <OrganizationItems organization={organization} />
      {!last && <DropdownMenuSeparator />}
    </>
  );
}

/**
 * A team chat's organizations (decision 100). When its agents work at the same organization the
 * header names it once, with their avatars stacked before it, and the menu lets each agent's
 * records be moved on their own. When they work at different ones, each agent has its own menu.
 */
export function TeamOrganizationMenu({ agents }: { agents: readonly GraduateSummary[] }) {
  const [places, setPlaces] = useState<Record<string, Place | null>>({});
  const onPlace = useCallback(
    (graduateId: string, place: Place | null) =>
      setPlaces((known) =>
        graduateId in known && known[graduateId]?.key === place?.key
          ? known
          : { ...known, [graduateId]: place },
      ),
    [],
  );
  const probes = agents.map((agent) => <PlaceOf key={agent.id} agent={agent} onPlace={onPlace} />);
  const placed = agents.filter((agent) => places[agent.id]);
  const first = placed[0] && places[placed[0].id];
  const shared =
    first !== undefined &&
    first !== null &&
    placed.length > 1 &&
    placed.every((agent) => places[agent.id]?.key === first.key);

  if (!shared || !first) {
    return (
      <>
        {probes}
        {agents.map((agent) => (
          <OrganizationMenu key={agent.id} agent={agent} named />
        ))}
      </>
    );
  }
  const names = placed.map((agent) => agent.name).join(' and ');
  return (
    <>
      {probes}
      <DropdownMenu>
        <Tooltip content={`${names} work at ${first.name}`} side="bottom">
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={cn(trigger, 'pl-1')}
              aria-label={`Organization of ${names}: ${first.name}`}
            >
              <span className="flex items-center">
                {placed.map((agent, index) => (
                  <AgentAvatar
                    key={agent.id}
                    name={agent.name}
                    className={cn('ring-2 ring-ground', index > 0 && '-ml-1.5')}
                  />
                ))}
              </span>
              {first.name}
              <ChevronDown size={14} strokeWidth={1.8} aria-hidden />
            </button>
          </DropdownMenuTrigger>
        </Tooltip>
        <DropdownMenuContent align="end" className="w-72">
          {placed.map((agent, index) => (
            <MemberItems key={agent.id} agent={agent} last={index === placed.length - 1} />
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
