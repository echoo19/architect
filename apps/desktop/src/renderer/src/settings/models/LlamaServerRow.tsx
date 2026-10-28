import { LlamaServerStatusSchema, type LlamaServerStatus } from '@architect/shared';
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
import { queryKeys } from '../../api/hooks';
import { setQueryData, useQuery } from '../../api/query';
import { errorOf } from '../../components/QueryValue';
import { attempt } from '../../lib/notify';
import { currentPlatform } from '../../lib/platform';

/** Where it was found and its build, when it works. */
function found(status: LlamaServerStatus) {
  if (status.source === 'path') return `Build ${status.build ?? ''} · on PATH`;
  return (
    <>
      Build {status.build} · <span className="break-all font-mono text-xs">{status.path}</span>
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
  const status = query.data;
  const problem = status && !status.ready ? `${status.problem ?? ''} ${status.hint ?? ''}` : null;
  const tooOld = status?.build !== undefined && status.build < status.minimumBuild;
  return (
    <SettingsRow
      icon={<ProviderMark name="llama.cpp" icon={<Cpu aria-hidden />} />}
      label="llama.cpp"
      meta={
        status?.ready
          ? found(status)
          : query.status === 'loading' && <Skeleton className="mt-1 h-3 w-40" />
      }
      error={errorOf(query) ?? problem?.trim()}
    >
      <span className="flex items-center gap-1.5">
        {tooOld && <SettingsValue>Too old</SettingsValue>}
        <IconButton label="Check again" size="sm" onClick={query.reload}>
          <RotateCw size={14} strokeWidth={1.8} aria-hidden />
        </IconButton>
        {status?.source === 'setting' && (
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
