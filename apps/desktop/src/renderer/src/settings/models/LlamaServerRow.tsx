import { LlamaServerStatusSchema } from '@architect/shared';
import {
  Button,
  IconButton,
  ProviderMark,
  SettingsRow,
  SettingsValue,
  Skeleton,
} from '@architect/ui';
import { Cpu, FolderOpen, RotateCw, X } from 'lucide-react';
import { api, architect } from '../../api/client';
import { queryKeys, useSettings } from '../../api/hooks';
import { setQueryData, useQuery } from '../../api/query';
import { errorOf } from '../../components/QueryValue';
import { attempt } from '../../lib/notify';
import { currentPlatform } from '../../lib/platform';
import { llamaServerRowState, type LlamaServerRowState } from './llamaServerState';

/** Where it was found and its build, when it works. */
function found({ build, path }: NonNullable<LlamaServerRowState['found']>) {
  if (path === null) return `Build ${build ?? ''} · on PATH`;
  return (
    <>
      Build {build} · <span className="break-all font-mono text-xs">{path}</span>
    </>
  );
}

async function choose(): Promise<void> {
  const [path] = await architect().files.pick({
    title: 'Choose llama-server',
    filters: currentPlatform() === 'win32' ? [{ name: 'llama-server', extensions: ['exe'] }] : [],
  });
  if (path === undefined) return;
  await select(path);
}

/** Uses this llama-server, or the one on PATH when null, and shows how it checked out. */
async function select(path: string | null): Promise<void> {
  const status = await architect().connections.chooseLlamaServer(path);
  setQueryData(queryKeys.llamaServer, LlamaServerStatusSchema.parse(status));
}

/**
 * llama.cpp's llama-server, which runs graduates that carry an adapter: found on PATH or chosen
 * here, its build, and a check that it runs and is new enough, with what to do when it isn't.
 */
export function LlamaServerRow() {
  const query = useQuery(queryKeys.llamaServer, api.llamaServer);
  const settings = useSettings();
  const row = llamaServerRowState(query.data, settings.data?.llamaServerPath);
  return (
    <SettingsRow
      icon={<ProviderMark name="llama.cpp" icon={<Cpu aria-hidden />} />}
      label="llama.cpp"
      meta={
        row.found
          ? found(row.found)
          : query.status === 'loading' && <Skeleton className="mt-1 h-3 w-40" />
      }
      error={errorOf(query) ?? row.problem ?? undefined}
    >
      <span className="flex items-center gap-1.5">
        {row.tooOld && <SettingsValue>Too old</SettingsValue>}
        <IconButton label="Check again" size="sm" onClick={query.reload}>
          <RotateCw size={14} strokeWidth={1.8} aria-hidden />
        </IconButton>
        {row.canClear && (
          <IconButton
            label="Use the one on PATH"
            size="sm"
            onClick={() => void attempt("Couldn't change llama-server", () => select(null))}
          >
            <X size={15} strokeWidth={1.8} aria-hidden />
          </IconButton>
        )}
        <Button
          size="xs"
          variant="ghost"
          onClick={() => void attempt("Couldn't use that program", choose)}
        >
          <FolderOpen size={13} aria-hidden />
          Choose
        </Button>
      </span>
    </SettingsRow>
  );
}
