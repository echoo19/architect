// The network guard goes first, as in the agent host process: everything after it can only reach
// this machine.
import { processGuard } from '../src/agent-host/guard/process-guard';
import { cp, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { WorkspaceEvent, WorkspaceMessage } from '@architect/shared';
import { createAgentHost, workspaceStore } from '../src/agent-host';
import { openEngineStore } from '../src/store/engine-store';

/**
 * One message to a graduate, headless, through the same agent host the workspace uses, with the
 * same loopback-only guard. A developer tool; it is not part of the app and never runs in CI.
 *
 *   pnpm --filter @architect/engine exec tsx scripts/chat.ts <dataDir> <graduateId> "<message>"
 *     [--approve]
 *
 * <dataDir> is the data folder a run wrote (scripts/run.ts prints it). The graduate works on a
 * copy of its job's data under <dataDir>/workspace/<graduateId>. Writes are denied unless
 * --approve is given.
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const approve = args.includes('--approve');
  const [dataArg, graduateId, text] = args.filter((arg) => arg !== '--approve');
  if (!dataArg || !graduateId || !text) {
    throw new Error('Usage: tsx scripts/chat.ts <dataDir> <graduateId> "<message>" [--approve]');
  }
  const dataDir = resolve(dataArg);
  const store = openEngineStore(join(dataDir, 'architect.db'));
  const graduate = store.graduates.get(graduateId);
  if (!graduate) throw new Error(`There is no graduate ${graduateId} in ${dataDir}.`);
  const job = store.jobs.get(graduate.manifest.jobId);
  const folder = join(dataDir, graduate.path);
  const workspaceData = join(dataDir, 'workspace', graduateId);
  if (job) {
    await mkdir(workspaceData, { recursive: true });
    await cp(join(dataDir, job.path, 'data'), workspaceData, { recursive: true, force: false });
  }

  const host = createAgentHost({ dataDir, store: workspaceStore(store) });
  try {
    await host.openGraduate(graduateId, folder, workspaceData);
    const chat = await host.createChat(graduateId);
    const finished = new Promise<WorkspaceMessage>((done) => {
      host.onEvent((event: WorkspaceEvent) => {
        if (event.type !== 'message.updated' || event.message.role !== 'agent') return;
        const { message } = event;
        for (const block of message.blocks) {
          if (block.kind === 'approval' && block.status === 'pending') {
            void host.decide(block.changeId, approve ? 'approve' : 'deny');
          }
        }
        if (message.status !== 'streaming') done(message);
      });
    });
    await host.send(chat.id, text);
    const reply = await finished;
    for (const step of reply.steps) {
      process.stdout.write(`  ${step.name} ${step.detail}${step.meta ? `  (${step.meta})` : ''}\n`);
    }
    for (const block of reply.blocks) {
      if (block.kind === 'approval') {
        process.stdout.write(`  [${block.status}] ${block.summary}\n`);
      } else if (block.kind === 'refusal') {
        process.stdout.write(`  [refused] ${block.reason}\n`);
      }
    }
    process.stdout.write(`\n${reply.text}\n\n(${reply.status}, ${reply.workedMs ?? 0} ms)\n`);
    const blocked = processGuard.blocked();
    process.stdout.write(`Network attempts blocked: ${blocked.length}\n`);
  } finally {
    await host.close();
    store.close();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
