import { useEffect, useId, useState } from 'react';
import type { GraduateSummary, Team } from '@architect/shared';
import {
  AgentAvatar,
  Button,
  Checkbox,
  Collapse,
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  Field,
  Input,
  Select,
  Textarea,
} from '@architect/ui';
import { CircleAlert, MessagesSquare, Trash2 } from 'lucide-react';
import { useVersions } from '../api/graduates';
import { toError } from '../api/query';
import { refreshTeams, removeTeam, teamsApi } from '../api/teams';
import { ProblemState } from '../components/ProblemState';
import { useTeamChats } from '../workspace/store';
import {
  defaultRole,
  MAX_TEAMMATES,
  ROLE_CHARS,
  teamAgents,
  teamInput,
  teamProblem,
  type TeammatePick,
} from './team-form';

export interface TeamDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The team to change; a new one is made without it. */
  team?: Team;
  graduates: readonly GraduateSummary[];
}

/**
 * Makes or changes a team (decision 100): its name, the lead that answers its chats, and up to
 * three teammates, each with a line on what the lead may ask it. A team keeps its lead for life,
 * so a team with another lead is a new team. Removing a team removes its chats. Give it a new
 * key each time it opens, so it starts from the team as saved.
 */
export function TeamDialog({ open, onOpenChange, team, graduates }: TeamDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <TeamForm
        {...(team ? { team } : {})}
        graduates={graduates}
        onDone={() => onOpenChange(false)}
      />
    </Dialog>
  );
}

function TeamForm({
  team,
  graduates,
  onDone,
}: {
  team?: Team;
  graduates: readonly GraduateSummary[];
  onDone: () => void;
}) {
  const id = useId();
  const agents = teamAgents(graduates);
  const [name, setName] = useState(team?.name ?? '');
  const [lead, setLead] = useState<string | undefined>(
    team?.members[0]?.graduateId ?? agents[0]?.id,
  );
  const [picks, setPicks] = useState<TeammatePick[]>(
    (team?.members.slice(1) ?? []).map((member) =>
      member.role === undefined
        ? { graduateId: member.graduateId }
        : { graduateId: member.graduateId, role: member.role },
    ),
  );
  const [defaults, setDefaults] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  // Said in the dialog, beside what can be changed: such as an agent that can't join a team.
  const [failure, setFailure] = useState<Error | null>(null);

  if (removing && team) {
    return <RemoveTeam team={team} onBack={() => setRemoving(false)} onRemoved={onDone} />;
  }

  const problem = teamProblem(name, lead, picks, graduates);
  const full = picks.length >= MAX_TEAMMATES;
  const teammates = agents.filter((agent) => agent.id !== lead);

  const toggle = (graduateId: string, chosen: boolean) =>
    setPicks((current) =>
      chosen
        ? [...current, { graduateId }]
        : current.filter((pick) => pick.graduateId !== graduateId),
    );
  const setRole = (graduateId: string, role: string) =>
    setPicks((current) =>
      current.map((pick) => (pick.graduateId === graduateId ? { graduateId, role } : pick)),
    );

  const save = async () => {
    if (lead === undefined || problem !== null) return;
    setSaving(true);
    setFailure(null);
    const input = teamInput(name, lead, picks, defaults);
    try {
      await (team ? teamsApi.update(team.id, input) : teamsApi.create(input));
    } catch (error) {
      setFailure(toError(error));
      setSaving(false);
      return;
    }
    await refreshTeams();
    setSaving(false);
    onDone();
  };

  return (
    <DialogContent title={team ? team.name : 'New team'}>
      <div className="flex flex-col gap-6 px-6 pt-5">
        <Field label="Name" htmlFor={`${id}-name`}>
          <Input
            id={`${id}-name`}
            value={name}
            maxLength={60}
            autoFocus
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <Field
          label="Lead"
          hint={team ? 'Stays for the team’s life' : 'Answers the team’s chats'}
          htmlFor={`${id}-lead`}
        >
          <Select
            aria-label="Lead"
            value={lead}
            disabled={team !== undefined}
            options={agents.map((agent) => ({ value: agent.id, label: agent.name }))}
            onValueChange={(next) => {
              setLead(next);
              setPicks((current) => current.filter((pick) => pick.graduateId !== next));
            }}
          />
        </Field>
        <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
          <legend className="mb-2 flex items-baseline gap-2 p-0 text-ui font-medium">
            Teammates
            <span className="text-small font-normal tabular-nums">
              {picks.length} of {MAX_TEAMMATES}
            </span>
          </legend>
          {teammates.length === 0 ? (
            <p className="m-0 text-ui">Teach another agent first.</p>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-1 p-0">
              {teammates.map((agent) => {
                const pick = picks.find((item) => item.graduateId === agent.id);
                return (
                  <TeammateRow
                    key={agent.id}
                    agent={agent}
                    lead={agents.find((item) => item.id === lead)?.name ?? 'The lead'}
                    pick={pick}
                    disabled={!pick && full}
                    onToggle={(chosen) => toggle(agent.id, chosen)}
                    onRole={(role) => setRole(agent.id, role)}
                    onDefault={(role) =>
                      setDefaults((current) =>
                        current[agent.id] === role ? current : { ...current, [agent.id]: role },
                      )
                    }
                  />
                );
              })}
            </ul>
          )}
        </fieldset>
        {failure && (
          <ProblemState
            layout="inline"
            error={failure}
            title={team ? `Couldn't save ${team.name}` : "Couldn't make the team"}
          />
        )}
        {/* An empty name speaks for itself; anything else that holds the team back is said. */}
        {problem !== null && name.trim() !== '' && (
          <p
            id={`${id}-problem`}
            role="status"
            className="m-0 flex items-center gap-2 text-small text-pretty"
          >
            <CircleAlert size={14} strokeWidth={1.8} aria-hidden className="shrink-0" />
            {problem}
          </p>
        )}
      </div>
      <DialogFooter>
        {team && (
          <Button variant="ghost" size="md" className="mr-auto" onClick={() => setRemoving(true)}>
            <Trash2 size={15} strokeWidth={1.8} aria-hidden />
            Remove team
          </Button>
        )}
        <DialogClose asChild>
          <Button size="md">Cancel</Button>
        </DialogClose>
        <Button
          variant="primary"
          size="md"
          loading={saving}
          disabled={problem !== null}
          aria-describedby={problem !== null && name.trim() !== '' ? `${id}-problem` : undefined}
          onClick={() => void save()}
        >
          {team ? 'Save' : 'Make team'}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

/**
 * An agent that can be a teammate: chosen, it takes a line on what the lead may ask it, which
 * starts as the summary of the contract it was taught on.
 */
function TeammateRow({
  agent,
  lead,
  pick,
  disabled,
  onToggle,
  onRole,
  onDefault,
}: {
  agent: GraduateSummary;
  /** The lead's name, which asks this teammate. */
  lead: string;
  pick: TeammatePick | undefined;
  disabled: boolean;
  onToggle: (chosen: boolean) => void;
  onRole: (role: string) => void;
  onDefault: (role: string) => void;
}) {
  const roleId = useId();
  const versions = useVersions(agent.id);
  const active = versions.data?.find((version) => version.version === agent.activeVersion);
  const contract = active?.manifest.contract;
  const fallback = defaultRole(contract?.summary ?? contract?.description);
  useEffect(() => onDefault(fallback), [fallback, onDefault]);
  return (
    <li className="flex flex-col">
      <Checkbox
        checked={pick !== undefined}
        disabled={disabled}
        onCheckedChange={onToggle}
        className="h-10"
        label={
          <span className="flex items-center gap-2.5">
            <AgentAvatar name={agent.name} />
            {agent.name}
          </span>
        }
      />
      <Collapse open={pick !== undefined}>
        <Field
          label={`What ${lead} asks it for`}
          htmlFor={roleId}
          className="pb-3 pl-[30px] pr-1 pt-1"
        >
          <Textarea
            id={roleId}
            rows={2}
            value={pick?.role ?? fallback}
            maxLength={ROLE_CHARS}
            placeholder="What it does for the team"
            className="min-h-0 resize-none"
            onChange={(event) => onRole(event.target.value)}
          />
        </Field>
      </Collapse>
    </li>
  );
}

/** Removing a team takes its chats with it, so it is asked once more, with the count. */
function RemoveTeam({
  team,
  onBack,
  onRemoved,
}: {
  team: Team;
  onBack: () => void;
  onRemoved: () => void;
}) {
  const chats = useTeamChats(team.id);
  const count = chats.entry.data?.length;
  const [busy, setBusy] = useState(false);
  // Such as a team still answering in one of its chats, which stays until its replies stop.
  const [failure, setFailure] = useState<Error | null>(null);
  const remove = async () => {
    setBusy(true);
    setFailure(null);
    try {
      await removeTeam(team.id);
    } catch (error) {
      setFailure(toError(error));
      setBusy(false);
      return;
    }
    setBusy(false);
    onRemoved();
  };
  return (
    <DialogContent title={`Remove ${team.name}?`}>
      <p className="m-0 flex items-start gap-3 px-6 pt-4 text-ui text-pretty">
        <MessagesSquare size={15} strokeWidth={1.8} aria-hidden className="mt-0.5 shrink-0" />
        {count === undefined
          ? 'Its chats are removed with it.'
          : count === 0
            ? 'It has no chats. Its agents stay as they are.'
            : `Its ${count === 1 ? 'chat is' : `${count} chats are`} removed with it. Its agents stay as they are.`}
      </p>
      {failure && (
        <ProblemState
          layout="inline"
          error={failure}
          title={`Couldn't remove ${team.name}`}
          className="px-6 pt-4"
        />
      )}
      <DialogFooter>
        <Button size="md" onClick={onBack}>
          Keep it
        </Button>
        <Button variant="danger" size="md" loading={busy} onClick={() => void remove()}>
          Remove team
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
