import { useCallback, useEffect, useId, useState, type FormEvent, type ReactNode } from 'react';
import type {
  ModelConfigRead,
  ModelConfigSource,
  TrainingPlan,
  TrainMethod,
  TrainPrecision,
} from '@architect/shared';
import {
  Button,
  Card,
  ChoiceTiles,
  ErrorState,
  Field,
  Input,
  Inspector,
  Segmented,
  Select,
  Stat,
  type InspectorTab,
} from '@architect/ui';
import { Binary, Boxes, Cpu, FileJson, Layers2, SlidersHorizontal } from 'lucide-react';
import { flowApi } from '../api/client';
import { computeApi } from '../api/compute';
import { useJob } from '../api/hooks';
import { toError } from '../api/query';
import { Breakdown } from '../compute/Breakdown';
import { BundleCard } from '../compute/BundleCard';
import {
  DEFAULT_SETTINGS,
  GPU_OPTIONS,
  paramsText,
  planFor,
  planRequest,
  type PlanFor,
  type PlanSettings,
} from '../compute/model';
import { QualifyCard } from '../compute/QualifyCard';
import { Targets } from '../compute/Targets';
import { NumberRow } from '../experiments/NumberRow';
import { attempt } from '../lib/notify';
import { PlacePage } from '../shell/PlacePage';

type Tab = 'hardware' | 'training';

const tabIcon = { size: 16, strokeWidth: 1.7, 'aria-hidden': true } as const;

const TABS: readonly InspectorTab<Tab>[] = [
  { value: 'hardware', label: 'Hardware', icon: <Cpu {...tabIcon} /> },
  { value: 'training', label: 'Training', icon: <SlidersHorizontal {...tabIcon} /> },
];

const METHODS = [
  { value: 'lora', label: 'LoRA', icon: <Layers2 aria-hidden /> },
  { value: 'qlora', label: 'QLoRA', icon: <Binary aria-hidden /> },
  { value: 'full', label: 'Full', icon: <Boxes aria-hidden /> },
] as const;

/**
 * Compute: where training runs, a training job planned from a model's own config.json with its
 * memory term by term, and a bundle for a cluster the person submits themselves (decision 072).
 * Opened from a field, the plan starts from its student's model and the bundle from its latest
 * export (decision 093).
 */
export function ComputeScreen({
  jobId,
  model,
}: {
  jobId?: string | undefined;
  model?: string | undefined;
}) {
  if (jobId === undefined) return <Compute field={null} fieldError={null} />;
  return <FieldCompute jobId={jobId} model={model} />;
}

/** Compute for a field: its job is read first, so the plan starts from its student's model. */
function FieldCompute({ jobId, model }: { jobId: string; model: string | undefined }) {
  const job = useJob(jobId);
  if (job.status === 'loading') return <Compute field={null} fieldError={null} waiting />;
  return (
    <Compute
      field={planFor(jobId, job.data ?? null, model)}
      fieldError={job.status === 'error' && model === undefined ? job.error : null}
    />
  );
}

function Compute({
  field,
  fieldError,
  waiting = false,
}: {
  field: PlanFor | null;
  fieldError: Error | null;
  waiting?: boolean;
}) {
  const [settings, setSettings] = useState<PlanSettings>(DEFAULT_SETTINGS);
  const [read, setRead] = useState<ModelConfigRead | null>(null);
  const [plan, setPlan] = useState<TrainingPlan | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  // Undefined until the plan sends the person to its hardware: the inspector keeps its own.
  const [tab, setTab] = useState<Tab | undefined>(undefined);
  const onRead = useCallback((next: ModelConfigRead) => {
    setPlan(null);
    setRefusal(null);
    setRead(next);
  }, []);

  useEffect(() => {
    if (read === null) return;
    let live = true;
    computeApi.plan(planRequest(read, settings)).then(
      (next) => {
        if (!live) return;
        setPlan(next);
        setRefusal(null);
      },
      (error: unknown) => {
        if (!live) return;
        setPlan(null);
        setRefusal(toError(error).message);
      },
    );
    return () => {
      live = false;
    };
  }, [read, settings]);

  return (
    <PlacePage
      title="Compute"
      aside={
        <Inspector<Tab>
          aria-label="Plan settings"
          tabs={TABS}
          rememberAs="compute"
          {...(tab === undefined ? {} : { tab })}
          onTabChange={setTab}
        >
          {(tab) => <Settings tab={tab} settings={settings} onChange={setSettings} />}
        </Inspector>
      }
    >
      <div className="flex max-w-[880px] flex-col gap-4">
        <Targets />
        <PlanCard
          key={waiting ? 'waiting' : 'ready'}
          field={field}
          fieldError={fieldError}
          read={read}
          plan={plan}
          method={settings.method}
          onMethod={(method) => setSettings({ ...settings, method })}
          onRead={onRead}
        />
        {refusal !== null && (
          <Card title="Memory on each GPU">
            <p className="m-0 font-display text-h1 font-semibold">Can&apos;t size this model</p>
            <p className="m-0 mt-2 max-w-[640px] text-body">{refusal}</p>
          </Card>
        )}
        {plan && (
          <Breakdown plan={plan} settings={settings} onChangeHardware={() => setTab('hardware')} />
        )}
        {read && (
          <BundleCard read={read} plan={plan} settings={settings} jobId={field?.jobId ?? null} />
        )}
        <QualifyCard />
      </div>
    </PlacePage>
  );
}

/** The field a plan is for, in one line: its name and its student's model. */
function FieldLine({ field }: { field: PlanFor }) {
  const model = <span className="font-mono text-small">{field.model}</span>;
  const name = field.name && <span className="font-medium">{field.name}</span>;
  if (field.repo !== null) {
    return (
      <p className="m-0 text-ui">
        For {name ?? model}
        {name && <>, from its student {model}</>}
      </p>
    );
  }
  return (
    <p className="m-0 text-ui text-pretty">
      For {name ?? model}. {name && <>Its student, {model}, has</>}
      {!name && 'It has'} no Hugging Face repository Architect knows; enter the one it was made
      from.
    </p>
  );
}

/** The model to size, read from the Hub or from a file, and the method it is trained with. */
function PlanCard({
  field,
  fieldError,
  read,
  plan,
  method,
  onMethod,
  onRead,
}: {
  field: PlanFor | null;
  fieldError: Error | null;
  read: ModelConfigRead | null;
  plan: TrainingPlan | null;
  method: TrainMethod;
  onMethod: (method: TrainMethod) => void;
  onRead: (read: ModelConfigRead) => void;
}) {
  const ids = { repo: useId(), revision: useId() };
  const [from, setFrom] = useState<ModelConfigSource['kind']>('hub');
  const [repo, setRepo] = useState(field?.repo ?? '');
  const [revision, setRevision] = useState('main');
  const [file, setFile] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const readFrom = async (source: ModelConfigSource) => {
    setReading(true);
    setProblem(null);
    try {
      onRead(await computeApi.readConfig(source));
    } catch (error) {
      setProblem(toError(error).message);
    } finally {
      setReading(false);
    }
  };

  // Opened from a field whose model is known, its config is read at once.
  const known = field?.repo ?? null;
  useEffect(() => {
    if (known === null) return;
    let live = true;
    setReading(true);
    computeApi.readConfig({ kind: 'hub', repo: known, revision: 'main' }).then(
      (next) => {
        if (!live) return;
        setReading(false);
        onRead(next);
      },
      (error: unknown) => {
        if (!live) return;
        setReading(false);
        setProblem(toError(error).message);
      },
    );
    return () => {
      live = false;
    };
  }, [known, onRead]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void readFrom({ kind: 'hub', repo: repo.trim(), revision: revision.trim() || 'main' });
  };

  const chooseFile = async () => {
    const [chosen] =
      (await attempt("Couldn't open the file", () =>
        flowApi.pickFiles({
          title: "Choose a model's config.json",
          filters: [{ name: 'Model config', extensions: ['json'] }],
        }),
      )) ?? [];
    if (chosen === undefined) return;
    setFile(chosen);
    await readFrom({ kind: 'file', path: chosen });
  };

  return (
    <Card
      title="Training plan"
      action={
        <Segmented
          aria-label="Where the config comes from"
          value={from}
          onValueChange={setFrom}
          options={[
            { value: 'hub', label: 'Hugging Face' },
            { value: 'file', label: 'config.json' },
          ]}
        />
      }
    >
      <div className="flex flex-col gap-5">
        {field && <FieldLine field={field} />}
        {fieldError && (
          <ErrorState
            layout="inline"
            title="Couldn't read the field"
            message={fieldError.message}
          />
        )}
        {from === 'hub' ? (
          <form className="flex items-end gap-3" onSubmit={submit}>
            <Field label="Model" htmlFor={ids.repo} className="min-w-0 flex-1">
              <Input
                id={ids.repo}
                value={repo}
                placeholder="owner/name"
                spellCheck={false}
                className="font-mono"
                onChange={(event) => setRepo(event.target.value)}
              />
            </Field>
            <Field label="Revision" htmlFor={ids.revision} className="w-40">
              <Input
                id={ids.revision}
                value={revision}
                spellCheck={false}
                className="font-mono"
                onChange={(event) => setRevision(event.target.value)}
              />
            </Field>
            <Button
              type="submit"
              variant={read === null ? 'primary' : 'secondary'}
              size="md"
              loading={reading}
              disabled={!/^[\w.-]+\/[\w.-]+$/.test(repo.trim())}
            >
              Read config
            </Button>
          </form>
        ) : (
          <div className="flex items-center gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-control bg-selected">
              <FileJson size={16} strokeWidth={1.7} aria-hidden />
            </span>
            <span className="min-w-0 flex-1 truncate font-mono text-small">
              {file ?? 'No file chosen'}
            </span>
            <Button
              variant={read === null ? 'primary' : 'secondary'}
              size="md"
              loading={reading}
              onClick={() => void chooseFile()}
            >
              Choose config.json
            </Button>
          </div>
        )}
        {problem && (
          <ErrorState layout="inline" title="Couldn't read the config" message={problem} />
        )}
        {read && plan && <ModelFacts read={read} plan={plan} />}
        {read === null && field === null && (
          <p className="m-0 text-ui">
            Enter a model on Hugging Face, or choose its config.json, to see the GPUs training it
            takes.
          </p>
        )}
        <ChoiceTiles<TrainMethod>
          aria-label="Method"
          columns={3}
          value={method}
          onValueChange={onMethod}
          options={METHODS}
        />
      </div>
    </Card>
  );
}

/** What was sized: the model at its commit, its parameters, layers and experts. */
function ModelFacts({ read, plan }: { read: ModelConfigRead; plan: TrainingPlan }) {
  const { size } = plan;
  return (
    <div className="flex flex-col gap-4 border-t border-line pt-5">
      <p className="m-0 truncate text-ui">
        <span className="font-medium">{read.model.repo ?? 'config.json'}</span>
        {read.model.revision && (
          <span className="font-mono text-small"> @ {read.model.revision.slice(0, 12)}</span>
        )}
        <span> · {size.architecture}</span>
      </p>
      <div className="grid grid-cols-4 gap-6">
        <Stat value={paramsText(size.totalParams)} label="Parameters" />
        <Stat value={paramsText(size.activeParams)} label="Active per token" />
        <Stat value={size.layers} label="Layers" />
        <Stat
          value={size.experts === 0 ? '–' : size.experts}
          label={size.experts === 0 ? 'Dense' : `Experts, ${size.expertsPerToken} per token`}
        />
      </div>
    </div>
  );
}

/** An inspector tab's rows; the tab names them, so they carry no heading of their own. */
function Rows({ children }: { children: ReactNode }) {
  return <div className="flex flex-col pb-5">{children}</div>;
}

/** The inspector: the hardware a plan is sized for, and the shape of its training. */
function Settings({
  tab,
  settings,
  onChange,
}: {
  tab: Tab;
  settings: PlanSettings;
  onChange: (next: PlanSettings) => void;
}) {
  const set =
    <K extends keyof PlanSettings>(key: K) =>
    (value: PlanSettings[K] | undefined) => {
      if (value !== undefined) onChange({ ...settings, [key]: value });
    };
  if (tab === 'hardware') {
    return (
      <Rows>
        <div className="flex min-h-11 items-center gap-3 text-ui">
          <span className="min-w-0 flex-1 font-medium">GPU</span>
          <Select
            aria-label="GPU"
            className="w-40"
            value={settings.gpu}
            onValueChange={set('gpu')}
            options={GPU_OPTIONS}
          />
        </div>
        <NumberRow
          label="GPUs per node"
          value={settings.gpusPerNode}
          integer
          min={1}
          max={64}
          onChange={set('gpusPerNode')}
        />
        <div className="flex min-h-11 items-center gap-3 text-ui">
          <span className="min-w-0 flex-1 font-medium">Precision</span>
          <Segmented<TrainPrecision>
            aria-label="Precision"
            value={settings.precision}
            onValueChange={set('precision')}
            options={[
              { value: 'bf16', label: 'bf16' },
              { value: 'fp16', label: 'fp16' },
              { value: 'fp32', label: 'fp32' },
            ]}
          />
        </div>
      </Rows>
    );
  }
  return (
    <Rows>
      <NumberRow
        label="Tokens per sequence"
        value={settings.seqLen}
        integer
        min={1}
        max={1_048_576}
        onChange={set('seqLen')}
      />
      <NumberRow
        label="Sequences per micro-batch"
        value={settings.microBatch}
        integer
        min={1}
        max={1024}
        onChange={set('microBatch')}
      />
      {settings.method !== 'full' && (
        <NumberRow
          label="LoRA rank"
          value={settings.loraRank}
          integer
          min={1}
          max={1024}
          onChange={set('loraRank')}
        />
      )}
    </Rows>
  );
}
