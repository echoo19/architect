import type { ReactNode } from 'react';
import type { HubTokenStatus } from '@architect/shared';
import { Badge, Button, Card, CardGrid, Skeleton } from '@architect/ui';
import { Cloud, Container, Laptop, Server } from 'lucide-react';
import { useHubToken, useLlamaServer, useLocalRuntimes } from '../api/hooks';
import { formatBytes } from '../lib/format';
import { useUi } from '../state/ui';

const TOKEN_SOURCES: Record<NonNullable<HubTokenStatus['source']>, string> = {
  saved: 'Saved in Architect',
  HF_TOKEN: 'HF_TOKEN',
  HUGGING_FACE_HUB_TOKEN: 'HUGGING_FACE_HUB_TOKEN',
  token_file: "Hugging Face's token file",
};

/** One fact of a target: its name at the left, its value at the right. */
function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-9 items-center justify-between gap-4 border-t border-line text-ui">
      <span className="font-medium">{label}</span>
      <span className="min-w-0 truncate text-right tabular-nums">{children}</span>
    </div>
  );
}

function Lead({ children }: { children: ReactNode }) {
  return <p className="m-0 pb-3 text-ui">{children}</p>;
}

/** The command a cluster target's bundle is submitted with, whole. */
function Command({ children }: { children: string }) {
  return (
    <div className="mt-auto flex min-h-9 items-center border-t border-line pt-1 font-mono text-small">
      {children}
    </div>
  );
}

/** Where training can run, each with what it can do and how it stands now. */
export function Targets() {
  const local = useLocalRuntimes();
  const llama = useLlamaServer();
  const token = useHubToken();
  const openSettings = useUi((state) => state.openSettings);
  const hasToken = token.data !== undefined && token.data.source !== null;
  const loading = <Skeleton className="h-4 w-20" />;

  return (
    <CardGrid className="items-stretch 2xl:grid-cols-2">
      <Card title="This computer" icon={<Laptop aria-hidden />}>
        <Lead>Runs the student and serves its adapters. Trains nothing here.</Lead>
        <Fact label="GPU">
          {local.data === undefined
            ? loading
            : local.data.gpu === null
              ? 'Not found'
              : `${local.data.gpu.name} · ${formatBytes(local.data.gpu.memoryBytes)}`}
        </Fact>
        <Fact label="Ollama">
          {local.data === undefined
            ? loading
            : local.data.ollama.running
              ? `Running${local.data.ollama.version ? ` · ${local.data.ollama.version}` : ''}`
              : 'Not running'}
        </Fact>
        <Fact label="llama-server">
          {llama.data === undefined
            ? loading
            : llama.data.source === null
              ? 'Not found'
              : `${llama.data.ready ? 'Ready' : 'Too old'}${llama.data.build ? ` · build ${llama.data.build}` : ''}`}
        </Fact>
      </Card>
      <Card
        title="Hugging Face Jobs"
        icon={<Cloud aria-hidden />}
        action={
          token.data === undefined ? undefined : (
            <Badge>{hasToken ? 'Ready' : 'Needs a token'}</Badge>
          )
        }
      >
        <Lead>
          Trains a LoRA adapter for the student on one rented GPU, within its compute cap.
        </Lead>
        <Fact label="Token">
          {token.data === undefined ? (
            loading
          ) : token.data.source === null ? (
            <Button size="xs" onClick={() => openSettings('models', 'huggingface')}>
              Add token
            </Button>
          ) : (
            TOKEN_SOURCES[token.data.source]
          )}
        </Fact>
      </Card>
      <Card title="Slurm" icon={<Server aria-hidden />} action={<Badge>Experimental</Badge>}>
        <Lead>
          Writes an sbatch bundle that runs torchrun with FSDP across nodes. You submit it.
        </Lead>
        <Command>sbatch submit.sbatch</Command>
      </Card>
      <Card
        title="Kubernetes"
        icon={<Container aria-hidden />}
        action={<Badge>Experimental</Badge>}
      >
        <Lead>Writes a PyTorchJob for the Kubeflow training operator. You apply it.</Lead>
        <Command>kubectl apply -f pytorchjob.yaml</Command>
      </Card>
    </CardGrid>
  );
}
