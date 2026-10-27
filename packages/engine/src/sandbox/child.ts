import { startSandboxChild } from './child-server';

startSandboxChild().catch((error: unknown) => {
  const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`The sandbox could not start: ${detail}\n`);
  process.exit(1);
});
