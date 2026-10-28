import { randomBytes } from 'node:crypto';
import { statSync } from 'node:fs';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Readable } from 'node:stream';
import {
  RUN_REQUEST_FORMAT,
  RunRequestSchema,
  type CliOutcome,
  type RunResult,
} from '@architect/shared';
import { countOption, flag, stringOption, type Parsed } from '../args';
import type { CliContext } from '../context';
import { CliError, failureOf } from '../exit';
import { line, sayFailure, stepLine } from '../render';
import { approvalPrompter } from './approvals';
import { outcomeOf, runResult, type Outcome } from './result';
import { ask, openSession, type AgentSession } from './session';

async function readAll(stream: Readable): Promise<string> {
  const parts: Buffer[] = [];
  for await (const part of stream) parts.push(Buffer.from(part as Uint8Array));
  return Buffer.concat(parts).toString('utf8');
}

/** The request file, read and checked against the request format before anything runs. */
async function readRequest(ctx: CliContext, source: string) {
  let text: string;
  if (source === '-') {
    text = await readAll(ctx.io.stdin);
  } else {
    const path = ctx.path(source);
    try {
      text = await readFile(path, 'utf8');
    } catch (error) {
      throw new CliError(
        'invalid_input',
        'input_unreadable',
        `${path} can't be read: ${(error as NodeJS.ErrnoException).code ?? String(error)}.`,
      );
    }
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch (error) {
    throw new CliError(
      'invalid_input',
      'invalid_json',
      `The request isn't valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const request = RunRequestSchema.safeParse(raw);
  if (!request.success) {
    throw new CliError(
      'invalid_input',
      'invalid_request',
      `The request doesn't match ${RUN_REQUEST_FORMAT}: ${request.error.issues
        .map((issue) => `${issue.path.join('.') || 'it'} ${issue.message}`)
        .join('; ')}.`,
      'docs/CLI.md shows the request format.',
    );
  }
  return request.data;
}

/**
 * Checks each input reference against the agent's contract and this computer's setup: a file
 * its job names, in a folder that is bound and granted, that exists.
 */
function checkInputs(session: AgentSession, inputs: readonly string[]): void {
  const { manifest } = session.version;
  const { installation } = session;
  for (const reference of inputs) {
    const [folder = '', ...rest] = reference.split('/');
    const name = rest.join('/');
    if (rest.some((part) => part === '' || part === '.' || part === '..')) {
      throw new CliError(
        'invalid_input',
        'invalid_input_reference',
        `"${reference}" isn't a path in ${folder}/.`,
      );
    }
    if (folder === 'data' && !manifest.contract.inputs.files.some((file) => file.name === name)) {
      const named = manifest.contract.inputs.files.map((file) => `data/${file.name}`).join(', ');
      throw new CliError(
        'invalid_input',
        'unknown_input',
        `${reference} isn't a file ${session.agent.name}'s job names. It can open ${named || 'no data files'}.`,
      );
    }
    if (folder === 'output' && manifest.contract.outputs.folder === undefined) {
      throw new CliError(
        'invalid_input',
        'unknown_input',
        `${session.agent.name} has no output/ folder.`,
      );
    }
    const bound = installation.bindings[folder];
    if (bound === undefined || (installation.grants.resources[folder] ?? 'none') === 'none') {
      throw new CliError(
        'not_permitted',
        'not_granted',
        `${session.agent.name} may not open ${folder}/ on this computer, so it can't read ${reference}.`,
      );
    }
    if (!statSync(join(bound, ...rest), { throwIfNoEntry: false })?.isFile()) {
      throw new CliError('invalid_input', 'input_missing', `${reference} isn't in ${bound}.`);
    }
  }
}

/** The request as the agent reads it: the task, then the files it is about. */
function taskText(task: string, inputs: readonly string[]): string {
  return inputs.length === 0 ? task : `${task}\n\nFiles: ${inputs.join(', ')}`;
}

/** Writes the result whole or not at all. */
async function writeResult(path: string, result: RunResult): Promise<void> {
  const temporary = `${path}.${randomBytes(4).toString('hex')}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

/**
 * `architect run <agent> --input request.json`: one task from a versioned JSON request, checked
 * before anything runs, and a versioned JSON result, always. Steps and messages go to stderr;
 * stdout carries only the result when no --output file is named. With --non-interactive (or
 * without a terminal) a write that needs approval ends the run with `approval_required`.
 */
export async function runBatch(
  ctx: CliContext,
  parsed: Parsed,
  signal: AbortSignal,
): Promise<CliOutcome> {
  const { io } = ctx;
  const { values } = parsed;
  const startedAt = new Date();
  const target = stringOption(values, 'output');
  const output = target === undefined || target === '-' ? null : ctx.path(target);
  if (output !== null && !statSync(dirname(output), { throwIfNoEntry: false })?.isDirectory()) {
    throw new CliError('invalid_input', 'not_a_folder', `${dirname(output)} isn't a folder.`);
  }
  const timeoutSeconds = countOption(values, 'timeout');
  const save = flag(values, 'save');
  const source = stringOption(values, 'input') ?? '-';
  // A request read from stdin leaves no one there to answer an approval.
  const interactive = io.terminal && source !== '-' && !flag(values, 'non-interactive');

  let session: AgentSession | null = null;
  let message = null;
  let inputs: string[] = [];
  let outcome: Outcome;
  const stop = new AbortController();
  const cancel = new AbortController();
  let timedOut = false;
  const timer =
    timeoutSeconds === undefined
      ? undefined
      : setTimeout(() => {
          timedOut = true;
          stop.abort(new Error('Timed out.'));
        }, timeoutSeconds * 1000);
  const ended = AbortSignal.any([signal, stop.signal, cancel.signal]);
  try {
    const request = await readRequest(ctx, source);
    inputs = request.inputs;
    session = await openSession(ctx, parsed.args[0] ?? '', { save });
    if (request.version !== undefined && request.version !== session.version.version) {
      throw new CliError(
        'not_permitted',
        'version_mismatch',
        `The request asks for version ${request.version}, and ${session.agent.name}'s active version is ${session.version.version}.`,
      );
    }
    checkInputs(session, request.inputs);
    line(io.stderr, `${session.agent.name}, version ${session.version.version}:`);
    if (ended.aborted) throw ended.reason;
    const reply = await ask(session, taskText(request.task, request.inputs), {
      approvals: interactive ? 'ask' : 'fail',
      ...(interactive
        ? {
            approve: approvalPrompter(ctx, ended, () =>
              cancel.abort(new Error('Stopped at the question.')),
            ),
          }
        : {}),
      onStep: (step) => line(io.stderr, stepLine(step)),
      signal: ended,
    });
    message = reply.message;
    outcome = outcomeOf(reply);
  } catch (error) {
    const failure =
      ended.aborted && !timedOut
        ? {
            outcome: 'cancelled' as const,
            code: 'cancelled',
            message: 'Stopped before it finished.',
          }
        : failureOf(error);
    outcome = { outcome: failure.outcome, failure };
  } finally {
    clearTimeout(timer);
    await session?.close();
  }
  if (timedOut) {
    outcome = {
      outcome: 'runtime_error',
      failure: {
        outcome: 'runtime_error',
        code: 'timeout',
        message: `Stopped after the ${timeoutSeconds ?? 0} seconds --timeout allows.`,
      },
    };
  }

  const result = runResult({
    outcome,
    session,
    message,
    inputs,
    saved: save,
    startedAt,
    finishedAt: new Date(),
  });
  if (output === null) io.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else await writeResult(output, result);
  if (outcome.failure) sayFailure(io.stderr, outcome.failure);
  else line(io.stderr, `Done in ${Math.round(result.duration_ms / 100) / 10} s.`);
  return outcome.outcome;
}
