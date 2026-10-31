import { useState } from 'react';
import { networkHostProblem, normalizeNetworkHost, type ClosedNetwork } from '@architect/shared';
import {
  Button,
  IconButton,
  Input,
  SettingsRow,
  SettingsSection,
  SettingsValue,
  Switch,
} from '@architect/ui';
import { Laptop, Server, X } from 'lucide-react';
import type { TabProps } from './SettingsModal';

const OFF: ClosedNetwork = { on: false, hosts: [] };

/**
 * The Lab's closed network (decision 098): while it is on, teaching reaches only the hosts named
 * here and this computer, and anything else is refused before a request is sent. Graduates are
 * held to less whatever it says: they reach only the model on this computer.
 */
export function ClosedNetworkRows({ settings, update }: TabProps) {
  const network = settings.closedNetwork ?? OFF;
  const [draft, setDraft] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const save = (next: ClosedNetwork) => update({ closedNetwork: next });

  const add = () => {
    const issue = networkHostProblem(draft);
    if (issue !== null) {
      setProblem(issue);
      return;
    }
    const host = normalizeNetworkHost(draft);
    if (!network.hosts.includes(host)) save({ ...network, hosts: [...network.hosts, host] });
    setDraft('');
    setProblem(null);
  };

  return (
    <SettingsSection title="Closed network">
      <SettingsRow
        label="Teaching reaches only these hosts"
        meta="And this computer. Any other is refused before anything is sent."
        error={settings.closedNetworkProblem}
      >
        <div className="flex items-center gap-3">
          {settings.closedNetworkProblem !== undefined && (
            <Button size="xs" onClick={() => save(network)}>
              Keep these hosts
            </Button>
          )}
          <Switch
            aria-label="Closed network"
            checked={network.on}
            onCheckedChange={(on) => save({ ...network, on })}
          />
        </div>
      </SettingsRow>
      {network.on && (
        <div role="list" aria-label="Hosts inside the network">
          <div role="listitem">
            <SettingsRow
              density="compact"
              icon={<Laptop size={16} strokeWidth={1.7} aria-hidden />}
              label="This computer"
            >
              <SettingsValue>Always inside</SettingsValue>
            </SettingsRow>
          </div>
          {network.hosts.map((host) => (
            <div role="listitem" key={host}>
              <SettingsRow
                density="compact"
                icon={<Server size={16} strokeWidth={1.7} aria-hidden />}
                label={host}
              >
                <IconButton
                  label={`Remove ${host}`}
                  size="sm"
                  onClick={() =>
                    save({ ...network, hosts: network.hosts.filter((item) => item !== host) })
                  }
                >
                  <X size={14} strokeWidth={1.8} aria-hidden />
                </IconButton>
              </SettingsRow>
            </div>
          ))}
        </div>
      )}
      {network.on && (
        <SettingsRow density="compact" label="Add a host" error={problem ?? undefined}>
          <form
            className="flex items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              add();
            }}
          >
            <Input
              aria-label="Host"
              aria-invalid={problem === null ? undefined : true}
              placeholder="vllm.lab.internal:8000"
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value);
                setProblem(null);
              }}
              className="h-8 w-60 font-mono"
            />
            <Button size="xs" type="submit" disabled={draft.trim() === ''}>
              Add
            </Button>
          </form>
        </SettingsRow>
      )}
    </SettingsSection>
  );
}
