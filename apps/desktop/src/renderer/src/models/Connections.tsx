import { DataTable, ProviderMark, Skeleton, useWindowBelow, type DataColumn } from '@architect/ui';
import { Check, Cpu } from 'lucide-react';
import { useSettings } from '../api/hooks';
import { ProblemState } from '../components/ProblemState';
import { DEFAULT_NAMES } from '../experiments/model';
import { mentorName, studentName } from '../lib/names';
import { rolesOf, type Connection, type ConnectionRoles } from '../settings/models/connections';
import { useConnections } from '../settings/models/hooks';

/** How a connection stands: a runtime here answers or not; a provider or endpoint is connected. */
function statusOf(connection: Connection): string {
  const { runtime } = connection;
  if (!runtime) return connection.secretRef ? 'Key saved' : 'Connected';
  if (!runtime.running) return connection.provider === 'ollama' ? 'Not running' : 'Not found';
  const count = runtime.models.length;
  return `Running, ${count} ${count === 1 ? 'model' : 'models'}`;
}

const ROLES = 'Can run';

function roleColumn(
  key: keyof ConnectionRoles,
  header: string,
  hint: string,
): DataColumn<Connection> {
  return {
    key,
    header,
    hint,
    group: ROLES,
    align: 'end',
    width: '120px',
    cell: (connection) =>
      rolesOf(connection)[key] ? (
        <Check size={16} strokeWidth={1.8} aria-label="Yes" className="ml-auto" />
      ) : null,
  };
}

/**
 * The table's columns, the roles named as the rest of the Lab says them: "Spark is teaching
 * Glimmer", and the specialists Glimmer becomes. An address stays on one line; on a narrow
 * window it steps aside, as Settings shows it too.
 */
function columns(mentor: string, student: string, narrow: boolean): DataColumn<Connection>[] {
  return [
    {
      key: 'connection',
      header: 'Connection',
      cell: (connection) => (
        <span className="flex items-center gap-3">
          <ProviderMark
            name={connection.label}
            icon={connection.local ? <Cpu aria-hidden /> : undefined}
          />
          {connection.label}
        </span>
      ),
    },
    {
      key: 'address',
      header: 'Address',
      hidden: narrow,
      cell: (connection) => (
        <span className="whitespace-nowrap font-mono text-small">{connection.baseUrl}</span>
      ),
    },
    { key: 'status', header: 'Status', width: '168px', cell: statusOf },
    roleColumn('teach', `${mentor}, teaching`, `It can serve ${mentor} as it teaches a field`),
    roleColumn(
      'practice',
      `${student}, practicing`,
      `${student} can practice on it while ${mentor} teaches it: here, or on a hosted or cluster copy`,
    ),
    roleColumn(
      'agent',
      'Specialists',
      `A finished specialist, ${student} with its harness, can run on it. Specialists run only on-premise`,
    ),
  ];
}

/**
 * Every place models come from, in one table: the providers with a saved key, the endpoints
 * added by address (a vLLM, SGLang, TGI or llama-server node as much as a hosted API) and the
 * runtimes on this computer, with how each stands and the roles it can fill. Read only; Settings
 * adds and removes them.
 */
export function ConnectionsView() {
  const { connections, secrets, local } = useConnections();
  const settings = useSettings();
  // The roles go by the default models' short names, Spark and Glimmer unless changed.
  const mentor = settings.data ? mentorName(settings.data.defaultMentor) : DEFAULT_NAMES.mentor;
  const student = settings.data ? studentName(settings.data.defaultStudent) : DEFAULT_NAMES.student;
  const narrow = useWindowBelow(1400);
  if (secrets.status === 'error') {
    return (
      <ProblemState
        error={secrets.error}
        title="Couldn't read your saved keys"
        onRetry={secrets.reload}
      />
    );
  }
  if (secrets.status === 'loading' || local.status === 'loading') {
    return <Skeleton className="h-64 rounded-card" />;
  }
  return (
    <DataTable
      aria-label="Connections"
      columns={columns(mentor, student, narrow)}
      rows={connections}
      rowKey={(connection) => connection.id}
      empty="Nothing is connected yet"
    />
  );
}
