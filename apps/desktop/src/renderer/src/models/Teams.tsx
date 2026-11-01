import type { GraduateSummary, Team } from '@architect/shared';
import { AgentAvatar, DataTable, EmptyState, Skeleton, type DataColumn } from '@architect/ui';
import { Users } from 'lucide-react';
import { useGraduates } from '../api/hooks';
import { useTeams } from '../api/teams';
import { ProblemState } from '../components/ProblemState';
import { namesInSentence } from '../workspace/labels';
import { useTeamChats } from '../workspace/store';
import { membersOf } from './team-form';

/** A team with its agents found, as a row of the table. */
interface TeamRow {
  team: Team;
  lead: GraduateSummary | undefined;
  teammates: GraduateSummary[];
}

/** How many chats a team has, read from the agent host. */
function ChatCount({ teamId }: { teamId: string }) {
  const chats = useTeamChats(teamId);
  const count = chats.entry.data?.length;
  return count === undefined ? null : <span className="tabular-nums">{count}</span>;
}

const COLUMNS: readonly DataColumn<TeamRow>[] = [
  {
    key: 'name',
    header: 'Team',
    sortValue: (row) => row.team.name,
    cell: (row) => (
      <span className="flex items-center gap-3 whitespace-nowrap font-medium">
        <Users size={16} strokeWidth={1.8} aria-hidden />
        {row.team.name}
      </span>
    ),
  },
  {
    key: 'lead',
    header: 'Lead',
    sortValue: (row) => row.lead?.name,
    cell: (row) =>
      row.lead && (
        <span className="flex items-center gap-2.5 whitespace-nowrap">
          <AgentAvatar name={row.lead.name} />
          {row.lead.name}
        </span>
      ),
  },
  {
    key: 'teammates',
    header: 'Teammates',
    sortValue: (row) => row.teammates.length,
    cell: (row) => namesInSentence(row.teammates.map((teammate) => teammate.name)),
  },
  {
    key: 'chats',
    header: 'Chats',
    align: 'end',
    width: '96px',
    cell: (row) => <ChatCount teamId={row.team.id} />,
  },
];

/**
 * Models › Teams: each saved team, its lead and its teammates (decision 100). A row opens the
 * team to change. A new team starts from the page's action, the one way to make one, so an empty
 * list doesn't offer a second.
 */
export function TeamsView({ onOpen }: { onOpen: (team: Team) => void }) {
  const teams = useTeams();
  const graduates = useGraduates();
  if (!teams.data || !graduates.data) {
    const failed =
      teams.status === 'error' ? teams : graduates.status === 'error' ? graduates : null;
    return failed?.error ? (
      <ProblemState
        error={failed.error}
        title={failed === teams ? "Couldn't load your teams" : "Couldn't load your agents"}
        onRetry={failed.reload}
      />
    ) : (
      <div aria-busy="true" aria-label="Loading teams">
        <Skeleton className="h-40 rounded-card" />
      </div>
    );
  }
  if (teams.data.length === 0) {
    return (
      <EmptyState
        icon={<Users aria-hidden />}
        title="No teams yet"
        description="Make a team whose lead asks its teammates for their part."
        className="pt-16"
      />
    );
  }
  const people = graduates.data;
  const rows = teams.data.map((team) => ({ team, ...membersOf(team, people) }));
  return (
    <DataTable
      aria-label="Teams"
      rows={rows}
      rowKey={(row) => row.team.id}
      columns={COLUMNS}
      onRowClick={(row) => onOpen(row.team)}
      initialSort={{ key: 'name', direction: 'ascending' }}
    />
  );
}
