import { useState } from 'react';
import type { WspModel } from '@architect/shared';
import { Button, DataTable, Skeleton, StatusMark } from '@architect/ui';
import { CircleCheck, FolderOpen, Lock } from 'lucide-react';
import { flowApi } from '../api/client';
import { useWspModels, wspApi } from '../api/wsp';
import { ProblemState } from '../components/ProblemState';
import { formatBytes } from '../lib/format';
import { attempt } from '../lib/notify';
import { parametersText, short } from './model';
import { StepBody } from './parts';

/** Where a model came from: its repository at its revision, or its folder. */
function origin(model: WspModel) {
  if (model.repo === undefined) return model.path;
  return model.revision === undefined ? model.repo : `${model.repo}@${short(model.revision, 7)}`;
}

/** Every model on the list once, by folder: those found, then those chosen, newest last. */
function merged(found: readonly WspModel[], chosen: readonly WspModel[]): WspModel[] {
  const known = new Set(found.map((model) => model.path));
  return [...found, ...chosen.filter((model) => !known.has(model.path))];
}

/**
 * Step one: the base model. Models found on this computer are listed with what an experiment
 * needs to know of each; one this method can't work on says why and can't be chosen.
 */
export function ModelStep({
  chosen,
  onChoose,
}: {
  chosen: WspModel | null;
  onChoose: (model: WspModel) => void;
}) {
  const models = useWspModels();
  // Folders picked here stay on the list for as long as the flow is open.
  const [picked, setPicked] = useState<WspModel[]>(chosen ? [chosen] : []);
  const [inspecting, setInspecting] = useState(false);

  const chooseFolder = async () => {
    const [folder] =
      (await attempt("Couldn't open the folder", () =>
        flowApi.pickFiles({ title: 'Choose a model folder', directory: true }),
      )) ?? [];
    if (folder === undefined) return;
    setInspecting(true);
    const model = await attempt("Couldn't read that model", () => wspApi.inspectModel(folder));
    setInspecting(false);
    if (!model) return;
    setPicked((current) => [...current.filter((item) => item.path !== model.path), model]);
    if (model.compatibility.supported) onChoose(model);
  };

  const rows = models.data ? merged(models.data, picked) : null;
  return (
    <StepBody
      title="Which model?"
      lede={
        <span className="flex items-center gap-2.5">
          <Lock size={16} strokeWidth={1.8} aria-hidden />
          Read only: nothing is ever written to the original checkpoint.
        </span>
      }
      end={
        <Button size="md" loading={inspecting} onClick={() => void chooseFolder()}>
          <FolderOpen size={16} strokeWidth={1.8} aria-hidden />
          Choose a folder
        </Button>
      }
    >
      {rows ? (
        <DataTable
          aria-label="Models"
          rows={rows}
          rowKey={(model) => model.path}
          selectedKey={chosen?.path}
          onRowClick={(model) => {
            if (model.compatibility.supported) onChoose(model);
          }}
          empty={
            <p className="m-0 px-6 py-5 text-ui">
              No model was found in the Hugging Face cache. Choose a folder that holds one.
            </p>
          }
          columns={[
            {
              key: 'name',
              header: 'Model',
              cell: (model) => (
                <span className="flex items-center gap-3">
                  <span className="flex size-6 shrink-0 items-center justify-center">
                    {chosen?.path === model.path && (
                      <CircleCheck
                        size={16}
                        strokeWidth={1.8}
                        role="img"
                        aria-label="Chosen"
                        className="text-student"
                      />
                    )}
                  </span>
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="font-medium">{model.name}</span>
                    <span className="truncate font-mono text-small">{origin(model)}</span>
                  </span>
                </span>
              ),
            },
            {
              key: 'parameters',
              header: 'Parameters',
              align: 'end',
              // A checkpoint whose tensors couldn't be read has no count, never a zero.
              cell: (model) => (model.parameters === 0 ? null : parametersText(model.parameters)),
            },
            {
              key: 'dtype',
              header: 'Weights',
              hint: 'The number format its weights are stored in',
              cell: (model) => model.dtype,
            },
            {
              key: 'size',
              header: 'On disk',
              align: 'end',
              cell: (model) => (
                <span className="whitespace-nowrap">{formatBytes(model.bytes)}</span>
              ),
            },
            {
              key: 'memory',
              header: 'Memory',
              hint: 'Estimated peak memory on this computer while an experiment runs',
              align: 'end',
              cell: (model) =>
                model.compatibility.supported ? (
                  <span className="whitespace-nowrap">
                    {Number(model.memoryGb.toFixed(1)).toLocaleString('en-US')} GB
                  </span>
                ) : null,
            },
            {
              key: 'compatibility',
              header: 'Compatibility',
              hint: 'Whether weight programs can read and edit this checkpoint',
              cell: (model) =>
                model.compatibility.supported ? (
                  <span className="flex items-center gap-2 whitespace-nowrap">
                    <StatusMark state="ok" />
                    Supported
                  </span>
                ) : (
                  <span className="flex items-start gap-2">
                    <StatusMark state="blocked" className="mt-0.5" />
                    <span className="flex flex-col">
                      <span className="whitespace-nowrap">Not supported</span>
                      {model.compatibility.reasons.map((reason) => (
                        <span key={reason} className="text-small">
                          {reason}
                        </span>
                      ))}
                    </span>
                  </span>
                ),
            },
          ]}
        />
      ) : models.status === 'error' ? (
        <ProblemState
          error={models.error}
          title="Couldn't look for models on this computer"
          onRetry={models.reload}
        />
      ) : (
        <Skeleton className="h-48 rounded-card" />
      )}
    </StepBody>
  );
}
