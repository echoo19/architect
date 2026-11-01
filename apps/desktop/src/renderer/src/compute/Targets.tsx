import type { ReactNode } from 'react';
import type { ClusterTarget, HubTokenStatus } from '@architect/shared';
import { Button, Card, CardGrid, CardRow, InfoTip, Skeleton, Tooltip } from '@architect/ui';
import { Cloud, CloudCog, Container, Laptop, Network, Server } from 'lucide-react';
import { useHubToken, useLlamaServer, useLocalRuntimes } from '../api/hooks';
import { formatBytes } from '../lib/format';
import { useUi } from '../state/ui';

const TOKEN_SOURCES: Record<NonNullable<HubTokenStatus['source']>, string> = {
  saved: 'Saved in Architect',
  HF_TOKEN: 'From the HF_TOKEN variable',
  HUGGING_FACE_HUB_TOKEN: 'From the HUGGING_FACE_HUB_TOKEN variable',
  token_file: "From Hugging Face's token file",
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
  const loading = <Skeleton className="h-4 w-20" />;

  return (
    <CardGrid className="items-stretch 2xl:grid-cols-2">
      <Card
        title="On-premise"
        icon={<Laptop aria-hidden />}
        action={
          <InfoTip about="on-premise">
            Runs Glimmer and serves its LoRA adapters on this computer. Fine-tunes nothing here.
          </InfoTip>
        }
      >
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
          <InfoTip about="Hugging Face Jobs">
            Fine-tunes a LoRA adapter for Glimmer on one rented GPU, within its compute cap.
          </InfoTip>
        }
      >
        <Fact label="Token">
          {token.data === undefined ? (
            loading
          ) : token.data.source === null ? (
            <Button size="xs" onClick={() => openSettings('models', 'huggingface')}>
              Add token
            </Button>
          ) : (
            // Ready in a word; where the token comes from is a hover away.
            <Tooltip content={TOKEN_SOURCES[token.data.source]} side="left">
              <span tabIndex={0} className="rounded-mark">
                Ready
              </span>
            </Tooltip>
          )}
        </Fact>
      </Card>
      <Card title="Clusters" icon={<Network aria-hidden />} wide flush>
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
