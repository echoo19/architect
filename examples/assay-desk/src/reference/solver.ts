import type { JsonValue } from '@architect/shared';
import type { Policy } from '../lab/policy';
import type { CsvRow } from '../lib/csv';
import type {
  NormalizeRequest,
  PlateRequest,
  ReplicateRequest,
  RetestPlanRequest,
} from '../tasks/build';
import { hitsCode, normalizeCode, qcCode, replicatesCode, reportCode, retestCode } from './code';
import { readPolicy } from './policy';
import type { AgentTools } from './tools';

/**
 * Reference solutions that use only the agent's built-in tools, the way a careful agent works:
 * read policy.md, send one piece of code to `run` that reads the plate's own files and works the
 * lab's rules out, and append any re-test rows. Nothing about a lab is known in advance: the
 * controls, the numbers, the reason codes, the instruments and how each export names its wells
 * all come from the files of the lab the tools are bound to. The working date is the one the
 * request states.
 */

function policyOf(tools: AgentTools): Policy {
  tools.readAll('policy.md');
  return readPolicy(tools.fileText('policy.md'));
}

export function normalize(tools: AgentTools, request: NormalizeRequest): JsonValue {
  return tools.run(normalizeCode(policyOf(tools), request.plate, request.wells));
}

export function hits(tools: AgentTools, request: PlateRequest): JsonValue {
  return tools.run(hitsCode(policyOf(tools), request.plate));
}

export function qc(tools: AgentTools, request: PlateRequest): JsonValue {
  return tools.run(qcCode(policyOf(tools), request.plate));
}

export function replicates(tools: AgentTools, request: ReplicateRequest): JsonValue {
  return tools.run(replicatesCode(policyOf(tools), request.plate, request.compound));
}

/** Appends the rows a run worked out, if any, and returns how many. */
function queue(tools: AgentTools, rows: CsvRow[]): number {
  if (rows.length > 0) tools.append('retests.csv', rows);
  return rows.length;
}

export function retestPlan(tools: AgentTools, request: RetestPlanRequest): JsonValue {
  const { rows } = tools.run<{ rows: CsvRow[] }>(
    retestCode(policyOf(tools), request.pick, tools.today),
  );
  return { retests: queue(tools, rows) };
}

export function plateReport(tools: AgentTools, request: PlateRequest): JsonValue {
  const report = tools.run<{
    plate: string;
    z_prime: number;
    qc: string;
    hits: string[];
    rows: CsvRow[];
  }>(reportCode(policyOf(tools), request.plate, tools.today));
  const { rows, ...facts } = report;
  return { ...facts, retests: queue(tools, rows) };
}
