import { DataTable, ProviderMark, Skeleton, type DataColumn } from '@architect/ui';
import { Check, Cpu } from 'lucide-react';
import { ProblemState } from '../components/ProblemState';
import { rolesOf, type Connection, type ConnectionRoles } from '../settings/models/connections';
import { useConnections } from '../settings/models/hooks';

/** How a connection stands: a runtime here answers or not; a provider or endpoint is connected. */
function statusOf(connection: Connection): string {
  const { runtime } = connection;
  if (!runtime) return connection.secretRef ? 'Key saved' : 'Connected';
  if (!runtime.running) return connection.provider === 'ollama' ? 'Not running' : 'Not found';
  const count = runtime.models.length;
  return `Running · ${count} ${count === 1 ? 'model' : 'models'}`;
}

const ROLES = 'Can be';

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

const COLUMNS: readonly DataColumn<Connection>[] = [
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
    cell: (connection) => (
      <span className="break-all font-mono text-small">{connection.baseUrl}</span>
    ),
  },
  { key: 'status', header: 'Status', width: '168px', cell: statusOf },
  roleColumn('teach', 'Teacher', 'It can serve the teacher of a field'),
  roleColumn(
    'practice',
    'Practice',
    'The student can practice on it while it is taught: here, or a hosted or cluster copy',
  ),
  roleColumn('agent', 'Agent', 'A finished agent can run on it. Agents run only on this computer'),
];

/**
 * Every place models come from, in one table: the providers with a saved key, the endpoints
 * added by address (a vLLM, SGLang, TGI or llama-server node as much as a hosted API) and the
 * runtimes on this computer, with how each stands and the roles it can fill. Read only; Settings
 * adds and removes them.
 */
export function ConnectionsView() {
  const { connections, secrets, local } = useConnections();
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
      columns={COLUMNS}
      rows={connections}
      rowKey={(connection) => connection.id}
      empty="Nothing is connected yet"
    />
  );
}
