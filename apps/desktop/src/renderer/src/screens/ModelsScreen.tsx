import { useCallback, useState } from 'react';
import { Button, EmptyState, Input, Segmented, Skeleton } from '@architect/ui';
import { Boxes, Search } from 'lucide-react';
import { ProblemState } from '../components/ProblemState';
import { navigate, paths } from '../lib/router';
import { CompareView } from '../models/CompareView';
import { useRegistry } from '../models/load';
import { ModelPanel } from '../models/ModelPanel';
import { RegistryTable } from '../models/RegistryTable';
import {
  matchesFilter,
  matchesSearch,
  ordered,
  type ModelRow,
  type RegistryFilter,
} from '../models/registry';
import { PlacePage } from '../shell/PlacePage';

const FILTERS: readonly { value: RegistryFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'candidates', label: 'Candidates' },
  { value: 'imported', label: 'Imported' },
];

/**
 * Models: every agent and every version of it on this computer, in one registry. A row opens its
 * panel at the right; two versions open side by side to compare.
 */
export function ModelsScreen() {
  const registry = useRegistry();
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [comparing, setComparing] = useState<[string, string] | null>(null);
  const rows = registry.data;
  const close = useCallback(() => setOpenKey(null), []);

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

  const open = openKey === null ? undefined : find(openKey);
  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <PlacePage title="Models">
          {rows.length === 0 ? (
            <EmptyState
              icon={<Boxes aria-hidden />}
              title="No models yet"
              description="Each agent Architect teaches is kept here, with every version of it."
              className="pt-16"
              actions={
                <Button variant="primary" size="md" onClick={() => navigate(paths.newAgent())}>
                  New agent
                </Button>
              }
            />
          ) : (
            <Registry
              rows={rows}
              openKey={open ? open.key : null}
              onOpen={(row) => setOpenKey(row.key)}
            />
          )}
        </PlacePage>
      </div>
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
