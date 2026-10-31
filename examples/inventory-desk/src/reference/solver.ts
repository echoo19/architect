import type { AgentTools, CsvRow } from '@architect/example-assay-desk';
import type { JsonValue } from '@architect/shared';
import type { Policy } from '../lab/policy';
import type { CompoundRequest, ListRequest } from '../tasks/build';
import { allocateCode, pickCode, reserveCode, usableCode } from './code';
import { readPolicy } from './policy';

/**
 * Reference solutions that use only the agent's built-in tools, the way a careful agent works:
 * read policy.md, send one piece of code to `run` that reads the lab's inventory and
 * reservations and draws by the lab's rules, and append any reservations. Nothing about a lab is
 * known in advance: its unit, date form, numbers and reason codes all come from the files of the
 * lab the tools are bound to. The working date is the one the request states.
 */

function policyOf(tools: AgentTools): Policy {
  tools.readAll('policy.md');
  return readPolicy(tools.fileText('policy.md'));
}

export function usable(tools: AgentTools, request: CompoundRequest): JsonValue {
  return tools.run(usableCode(policyOf(tools), tools.today, request.compound));
}

export function pickLot(tools: AgentTools, request: CompoundRequest): JsonValue {
  return tools.run(pickCode(policyOf(tools), tools.today, request.compound));
}

export function allocateList(tools: AgentTools, request: ListRequest): JsonValue {
  return tools.run(allocateCode(policyOf(tools), tools.today, request.compounds));
}

type Allocated = { compound: string; draws: JsonValue[]; reason: string | null };

export function reserve(tools: AgentTools, request: ListRequest): JsonValue {
  const { allocations, rows } = tools.run<{ allocations: Allocated[]; rows: CsvRow[] }>(
    reserveCode(policyOf(tools), tools.today, request.compounds),
  );
  if (rows.length > 0) tools.append('reservations.csv', rows);
  return {
    reserved: allocations.filter((a) => a.reason === null).map((a) => a.compound),
    unavailable: allocations
      .filter((a) => a.reason !== null)
      .map((a) => ({ compound: a.compound, reason: a.reason })),
  };
}
