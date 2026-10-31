import { allowedHostsOf, contactHost, insideNetwork } from '@architect/shared';
import { Button } from '@architect/ui';
import { useSettings } from '../../api/hooks';
import { useUi } from '../../state/ui';
import { InspectorRow } from './fields';

/** "a.example.com", "a.example.com and b.example.com", "a, b and c". */
function listed(hosts: readonly string[]): string {
  if (hosts.length <= 1) return hosts.join('');
  return `${hosts.slice(0, -1).join(', ')} and ${hosts.at(-1) ?? ''}`;
}

/**
 * While the Lab's closed network is on (decision 098), whether the models these addresses reach
 * are inside it; one outside it is refused when teaching starts, so the row says which and where
 * to add it. Nothing while no closed network is on.
 */
export function NetworkRow({ urls }: { urls: readonly string[] }) {
  const settings = useSettings();
  const hosts = allowedHostsOf(settings.data?.closedNetwork);
  if (hosts === undefined || urls.length === 0) return null;
  const outside = [
    ...new Set(urls.filter((url) => !insideNetwork(url, hosts)).map((url) => contactHost(url))),
  ];
  return (
    <div className="flex flex-col">
      <InspectorRow
        label="Closed network"
        error={
          outside.length === 0
            ? undefined
            : `${listed(outside)} ${outside.length === 1 ? 'is' : 'are'} outside it, so teaching would be refused before anything is sent. Add ${outside.length === 1 ? 'it' : 'them'} in Settings, or choose a model inside it.`
        }
      >
        {outside.length === 0 ? (
          <span className="text-ui">Inside</span>
        ) : (
          <Button size="xs" onClick={() => useUi.getState().openSettings('privacy')}>
            Open Settings
          </Button>
        )}
      </InspectorRow>
    </div>
  );
}
