import type { ReactNode } from 'react';
import type { ClusterTarget, HubTokenStatus } from '@architect/shared';
import { Badge, Button, Card, CardGrid, CardRow, Skeleton } from '@architect/ui';
import { Cloud, CloudCog, Container, Laptop, Network, Server } from 'lucide-react';
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

const clusterIcon = { size: 16, strokeWidth: 1.7, 'aria-hidden': true } as const;

/** The clusters a bundle can be written for: what each runs, and the command that submits it. */
export const CLUSTERS: readonly {
  target: ClusterTarget;
  name: string;
  icon: ReactNode;
  lead: string;
  command: string;
}[] = [
  {
    target: 'slurm',
    name: 'Slurm',
    icon: <Server {...clusterIcon} />,
    lead: 'FSDP across nodes with torchrun',
    command: 'sbatch submit.sbatch',
  },
  {
    target: 'kubernetes',
    name: 'Kubernetes',
    icon: <Container {...clusterIcon} />,
    lead: 'A PyTorchJob for the Kubeflow operator',
    command: 'kubectl apply -f pytorchjob.yaml',
  },
  {
    target: 'skypilot',
    name: 'SkyPilot',
    icon: <CloudCog {...clusterIcon} />,
    lead: 'Any cloud or Kubernetes your SkyPilot reaches',
    command: 'sky launch -c architect-train sky.yaml',
  },
];

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
        <Lead>Runs Glimmer and serves its adapters. Trains nothing here.</Lead>
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
        <Lead>Trains a LoRA adapter for Glimmer on one rented GPU, within its compute cap.</Lead>
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
      <Card
        title="Clusters"
        icon={<Network aria-hidden />}
        action={<Badge>Bundle only</Badge>}
        wide
        flush
      >
        <p className="m-0 px-6 pb-3 text-ui">
          Architect writes a bundle for your cluster. You submit it with your own tools.
        </p>
        {CLUSTERS.map((cluster) => (
          <CardRow
            key={cluster.target}
            icon={
              <span className="flex size-9 items-center justify-center rounded-control bg-selected">
                {cluster.icon}
              </span>
            }
            title={cluster.name}
            detail={cluster.lead}
            end={<span className="font-mono text-small">{cluster.command}</span>}
          />
        ))}
      </Card>
    </CardGrid>
  );
}
