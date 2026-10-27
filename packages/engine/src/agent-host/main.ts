// The guard must stay the first import: it is installed as soon as it is evaluated, before any
// other module of the host loads.
import { processGuard } from './guard/process-guard';
import { startAgentHostProcess } from './process';

try {
  startAgentHostProcess(processGuard);
} catch (error) {
  console.error(
    `The agent host could not start: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
}
