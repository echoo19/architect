import { useState, type ReactNode } from 'react';
import {
  GLIMMER_BUILDS,
  gpuFit,
  MENTOR_PRESETS,
  STUDENT_PRESETS,
  type GpuFit,
  type GpuInfo,
  type ModelEntry,
  type ProviderId,
  type TokenPricing,
} from '@architect/shared';
import { Combobox, StatusDot, type ComboboxGroup, type ComboboxOption } from '@architect/ui';
import { formatBytes } from '../../lib/format';
import {
  connectionOf,
  connectionsFor,
  localModelName,
  modelLabel,
  type Connection,
  type ModelChoice,
  type PickerRole,
} from './connections';
import { useConnections, useModelLists, type ListState } from './hooks';

export interface ModelPickerProps {
  role: PickerRole;
  'aria-label': string;
  /** What is chosen now: where it runs, and the model. Null for nothing, such as no hosted copy. */
  current: { provider?: ProviderId; baseUrl: string; model: string } | null;
  onChoose: (choice: ModelChoice) => void;
  /** A choice of none, offered first, such as for an optional hosted copy. */
  none?: { label: string; onChoose: () => void };
  /** Narrows the connections listed, such as to the runtimes on this computer. */
  only?: (connection: Connection) => boolean;
  disabled?: boolean;
  className?: string;
  /** What the closed control shows: the current choice. */
  children: ReactNode;
}

const NONE = '["none"]';

function valueOf(connectionId: string, model: string): string {
  return JSON.stringify([connectionId, model]);
}

/** "$1.25 · $4.25": dollars per million tokens in and out, or Free. */
export function priceText(pricing: TokenPricing): string {
  if (pricing.inputPerM === 0 && pricing.outputPerM === 0) return 'Free';
  const amount = (value: number) => `$${Number(value.toFixed(3))}`;
  return `${amount(pricing.inputPerM)} · ${amount(pricing.outputPerM)}`;
}

/** Whether a local model runs entirely on the GPU, as a dot and a word. */
export function GpuMark({ fit }: { fit: GpuFit }) {
  if (fit === 'unknown') return null;
  return (
    <span className="flex items-center gap-1.5">
      <StatusDot tone={fit === 'full' ? 'student' : 'faint'} />
      {fit === 'full' ? 'GPU' : 'Part CPU'}
    </span>
  );
}

function listedModels(connection: Connection, lists: Record<string, ListState>): ModelEntry[] {
  if (connection.runtime) return connection.runtime.models;
  const state = lists[connection.id];
  return state?.status === 'ready' ? state.models : [];
}

function noteOf(connection: Connection, lists: Record<string, ListState>): ReactNode {
  if (connection.offered) return 'Needs a key';
  if (connection.runtime) return connection.runtime.running ? null : 'Not running';
  const state = lists[connection.id];
  if (!state || state.status === 'loading') return 'Loading models';
  return state.status === 'error' ? state.message : null;
}

interface Builder {
  add(id: string, label: string, detail?: ReactNode): void;
  models: ModelEntry[];
}

/** The options of one connection's group, presets and known builds first. */
function fill(role: PickerRole, connection: Connection, gpu: GpuInfo | null, builder: Builder) {
  const { add, models } = builder;
  if (role === 'mentor') {
    for (const preset of MENTOR_PRESETS.filter((p) => p.provider === connection.provider)) {
      add(preset.model, preset.label, priceText(preset.pricing));
    }
    for (const model of models) {
      const detail = model.pricing
        ? priceText(model.pricing)
        : model.sizeBytes === undefined
          ? undefined
          : formatBytes(model.sizeBytes);
      add(model.id, modelLabel(model.id, model), detail);
    }
    return;
  }
  if (role === 'student') {
    for (const model of models) {
      add(
        model.id,
        localModelName(model.id),
        <>
          {model.sizeBytes === undefined ? null : formatBytes(model.sizeBytes)}
          <GpuMark fit={gpuFit(model, gpu)} />
        </>,
      );
    }
    if (connection.provider === 'ollama' && connection.runtime?.running) {
      for (const build of GLIMMER_BUILDS) {
        add(build.model, localModelName(build.model), 'Not downloaded');
      }
    }
    return;
  }
  for (const preset of STUDENT_PRESETS.filter((p) => p.baseUrl === connection.baseUrl)) {
    add(
      preset.model,
      preset.label.replace(/\s+on\s+.*$/i, ''),
      preset.pricing ? priceText(preset.pricing) : undefined,
    );
  }
  for (const model of models) {
    add(
      model.id,
      modelLabel(model.id, model),
      model.pricing ? priceText(model.pricing) : undefined,
    );
  }
}

/**
 * A model picker grouped by connection: the mentor from any connection, the agent's model from
 * the runtimes here (with whether each fits on the GPU), or a hosted copy for faster training.
 * Lists load when it opens, and a typed model id can be used on any connection.
 */
export function ModelPicker({
  role,
  current,
  onChoose,
  none,
  only,
  disabled,
  className,
  children,
  ...props
}: ModelPickerProps) {
  const { connections, gpu } = useConnections();
  const [open, setOpen] = useState(false);
  const listed = connectionsFor(role, connections).filter(only ?? (() => true));
  const connected = listed.filter((connection) => !connection.offered);
  const lists = useModelLists(connected, open);

  const groups: ComboboxGroup[] = [];
  if (none) groups.push({ heading: 'None', options: [{ value: NONE, label: none.label }] });
  for (const connection of listed) {
    const seen = new Set<string>();
    const options: ComboboxOption[] = [];
    fill(role, connection, gpu, {
      models: listedModels(connection, lists),
      add(id, label, detail) {
        if (seen.has(id)) return;
        seen.add(id);
        options.push({
          value: valueOf(connection.id, id),
          label,
          keywords: [id, connection.label],
          ...(detail ? { detail } : {}),
        });
      },
    });
    const note = noteOf(connection, lists);
    groups.push({ heading: connection.label, options, ...(note ? { note } : {}) });
  }

  const owner = current ? connectionOf(listed, current) : undefined;
  const value =
    current === null ? (none ? NONE : undefined) : owner && valueOf(owner.id, current.model);

  const choose = (picked: string) => {
    if (picked === NONE) {
      none?.onChoose();
      return;
    }
    const parsed: unknown = JSON.parse(picked);
    if (!Array.isArray(parsed) || parsed.length !== 2) return;
    const [connectionId, id] = parsed as [string, string];
    const connection = listed.find((candidate) => candidate.id === connectionId);
    if (!connection) return;
    const entry = listedModels(connection, lists).find((model) => model.id === id);
    onChoose({ connection, id, ...(entry ? { entry } : {}) });
  };

  return (
    <Combobox
      aria-label={props['aria-label']}
      value={value}
      onValueChange={choose}
      groups={groups}
      onOpenChange={setOpen}
      disabled={disabled}
      className={className}
      searchPlaceholder={role === 'student' ? 'Search models on this computer' : 'Search models'}
      emptyText={connected.length === 0 ? 'Nothing connected yet.' : 'No model matches that.'}
      fromSearch={(text) =>
        connected.length === 0
          ? null
          : {
              heading: 'Use this model id',
              options: connected.map((connection) => ({
                value: valueOf(connection.id, text),
                label: text,
                detail: connection.label,
              })),
            }
      }
    >
      {children}
    </Combobox>
  );
}
