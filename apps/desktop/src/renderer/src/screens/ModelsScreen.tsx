import { useCallback, useEffect, useState } from 'react';
import type { Team } from '@architect/shared';
import {
  Button,
  EmptyState,
  Input,
  PageTabs,
  Segmented,
  SidePresence,
  Skeleton,
  type PageTab,
} from '@architect/ui';
import { Boxes, Plug, Plus, Search, Users } from 'lucide-react';
import { useGraduates } from '../api/hooks';
import { ProblemState } from '../components/ProblemState';
import { navigate, paths } from '../lib/router';
import { Candidates } from '../models/Candidates';
import { CompareView } from '../models/CompareView';
import { ConnectionsView } from '../models/Connections';
import { useRegistry } from '../models/load';
import { ModelPanel } from '../models/ModelPanel';
import { RegistryTable } from '../models/RegistryTable';
import { TeamDialog } from '../models/TeamDialog';
import { TeamsView } from '../models/Teams';
import {
  matchesFilter,
  matchesSearch,
  ordered,
  STATUS_HINTS,
  type ModelRow,
  type RegistryFilter,
} from '../models/registry';
import { PlacePage } from '../shell/PlacePage';
import { useUi } from '../state/ui';

const FILTERS: readonly { value: RegistryFilter; label: string; hint?: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active', hint: STATUS_HINTS.active },
  { value: 'candidates', label: 'Candidates', hint: STATUS_HINTS.candidate },
  { value: 'imported', label: 'Imported', hint: STATUS_HINTS.imported },
];

type View = 'versions' | 'teams' | 'connections';

const tabIcon = { size: 16, strokeWidth: 1.7, 'aria-hidden': true } as const;

const VIEWS: readonly PageTab<View>[] = [
  { value: 'versions', label: 'Versions', icon: <Boxes {...tabIcon} /> },
  { value: 'teams', label: 'Teams', icon: <Users {...tabIcon} /> },
  { value: 'connections', label: 'Connections', icon: <Plug {...tabIcon} /> },
];

/**
 * Models: every agent and every version of it on this computer, in one registry. A row opens its
 * panel at the right; two versions open side by side to compare. Another place opens a version's
 * panel by naming it in the path (`open`). Beside the registry, the teams agents work in
 * (decision 100), and every connection models come from and the roles each can fill.
 */
export function ModelsScreen({
  open: asked,
  tab,
}: {
  open?: string | undefined;
  tab?: 'teams' | undefined;
}) {
  const registry = useRegistry();
  const graduates = useGraduates();
  const [openKey, setOpenKey] = useState<string | null>(asked ?? null);
  const [comparing, setComparing] = useState<[string, string] | null>(null);
  const [view, setView] = useState<View>(tab ?? 'versions');
  // The team the dialog shows, or a new one; each opening starts from the team as saved.
  const [editing, setEditing] = useState<{ team?: Team; open: boolean; count: number }>({
    open: false,
    count: 0,
  });
  const editTeam = (team?: Team) =>
    setEditing((current) => ({ ...(team ? { team } : {}), open: true, count: current.count + 1 }));
  useEffect(() => {
    if (tab !== undefined) setView(tab);
  }, [tab]);
  const openSettings = useUi((state) => state.openSettings);
  const rows = registry.data;
  useEffect(() => {
    if (asked === undefined) return;
    setOpenKey(asked);
    setComparing(null);
    setView('versions');
  }, [asked]);
  // Closed, the panel leaves the path too, so going back doesn't open it again.
  const close = useCallback(() => {
    setOpenKey(null);
    if (asked !== undefined) navigate(paths.models(), { replace: true });
  }, [asked]);

  if (!rows) {
    return (
      <PlacePage title="Models">
        {registry.status === 'error' ? (
          <ProblemState
            error={registry.error}
            title="Couldn't load your models"
            onRetry={registry.reload}
          />
        ) : (
          <Skeleton className="h-64 rounded-card" />
        )}
      </PlacePage>
    );
  }

  const find = (key: string) => rows.find((row) => row.key === key);
  const pair = comparing && [find(comparing[0]), find(comparing[1])];
  if (pair?.[0] && pair[1]) {
    return (
      <CompareView
        pair={[pair[0], pair[1]]}
        rows={rows}
        onChange={([before, after]) => setComparing([before.key, after.key])}
        onBack={() => setComparing(null)}
      />
    );
  }

  const open = view === 'versions' && openKey !== null ? find(openKey) : undefined;
  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <PlacePage
          title="Models"
          action={
            view === 'connections' ? (
              <Button size="md" onClick={() => openSettings('models')}>
                <Plus size={16} aria-hidden />
                Add provider or endpoint
              </Button>
            ) : view === 'teams' ? (
              <Button size="md" onClick={() => editTeam()}>
                <Plus size={16} aria-hidden />
                New team
              </Button>
            ) : undefined
          }
        >
          <PageTabs aria-label="Models" tabs={VIEWS} value={view} onValueChange={setView}>
            {view === 'connections' ? (
              <ConnectionsView />
            ) : view === 'teams' ? (
              <TeamsView onOpen={(team) => editTeam(team)} />
            ) : rows.length === 0 ? (
              <EmptyState
                icon={<Boxes aria-hidden />}
                title="No models yet"
                description="Every specialist you engineer is kept here, with each version."
                className="pt-16"
                actions={
                  <Button variant="primary" size="md" onClick={() => navigate(paths.newAgent())}>
                    New agent
                  </Button>
                }
              />
            ) : (
              <div className="flex flex-col gap-6">
                <Candidates
                  rows={rows}
                  onOpen={(row) => setOpenKey(row.key)}
                  onCompare={(candidate, active) => {
                    const [before, after] = ordered(active, candidate);
                    setComparing([before.key, after.key]);
                  }}
                />
                <Registry
                  rows={rows}
                  openKey={open ? open.key : null}
                  onOpen={(row) => setOpenKey(row.key)}
                />
              </div>
            )}
          </PageTabs>
        </PlacePage>
      </div>
      <SidePresence show={open !== undefined}>
        {open && (
          <ModelPanel
            key={open.key}
            row={open}
            rows={rows}
            onClose={close}
            onOpen={(row) => setOpenKey(row.key)}
            onCompare={(other) => {
              const [before, after] = ordered(open, other);
              setComparing([before.key, after.key]);
            }}
            onMoved={registry.reload}
          />
        )}
      </SidePresence>
      <TeamDialog
        key={editing.count}
        open={editing.open}
        onOpenChange={(open) => setEditing((current) => ({ ...current, open }))}
        {...(editing.team ? { team: editing.team } : {})}
        graduates={graduates.data ?? []}
      />
    </div>
  );
}

function Registry({
  rows,
  openKey,
  onOpen,
}: {
  rows: readonly ModelRow[];
  openKey: string | null;
  onOpen: (row: ModelRow) => void;
}) {
  const [filter, setFilter] = useState<RegistryFilter>('all');
  const [search, setSearch] = useState('');
  const shown = rows.filter((row) => matchesFilter(row, filter) && matchesSearch(row, search));
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented aria-label="Show" options={FILTERS} value={filter} onValueChange={setFilter} />
        <div className="relative w-72">
          <Search
            size={15}
            strokeWidth={1.8}
            aria-hidden
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2"
          />
          <Input
            type="search"
            aria-label="Search models"
            placeholder="Search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="pl-9"
          />
        </div>
      </div>
      <RegistryTable
        rows={shown}
        openKey={openKey}
        onOpen={onOpen}
        empty={search.trim() ? `Nothing matches “${search.trim()}”` : 'None here'}
      />
    </div>
  );
}
