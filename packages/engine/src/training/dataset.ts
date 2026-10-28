import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DATASET_EXAMPLE_FORMAT,
  DATASET_FORMAT,
  DatasetExampleSchema,
  DatasetManifestSchema,
  GuardError,
  VerifiedEpisodeSchema,
  type DatasetExample,
  type DatasetManifest,
  type DatasetMessage,
  type EpisodeMessage,
  type VerifiedEpisode,
} from '@architect/shared';
import { writeFileAtomic } from '../data/atomic-write';
import type { LeakDetector } from '../vault/fingerprint';

export const EXAMPLES_FILE = 'examples.jsonl';
export const DATASET_MANIFEST_FILE = 'dataset.json';

export interface BuildDatasetOptions {
  /**
   * Remote training sends the dataset off this computer, so episodes whose data may not leave it
   * are left out. Local training keeps them.
   */
  destination: 'remote' | 'local';
  /** The job's leak detector. An episode holding locked-test content stops the build. */
  leakDetector?: LeakDetector;
  now?: () => Date;
}

export interface BuiltDataset {
  examples: DatasetExample[];
  manifest: DatasetManifest;
  /** The examples file exactly as written; `manifest.examples_sha256` is its hash. */
  jsonl: string;
}

export class DatasetError extends Error {
  constructor(
    message: string,
    readonly excluded: readonly { episode_id: string; reason: string }[],
  ) {
    super(message);
    this.name = 'DatasetError';
  }
}

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

/** Why an episode's conversation can't be trained on as it stands, or null when it can. */
function conversationProblem(episode: VerifiedEpisode): string | null {
  const { messages } = episode;
  const offered = new Set(episode.tools.map((tool) => tool.name));
  let open = new Set<string>();
  for (const [index, message] of messages.entries()) {
    if (message.role === 'assistant') {
      if (open.size > 0) return `the tool calls before message ${index} were never answered`;
      if (messages[index - 1]?.role === 'assistant') {
        return `messages ${index - 1} and ${index} are two assistant turns in a row`;
      }
      open = new Set();
      for (const call of message.toolCalls ?? []) {
        if (!offered.has(call.name))
          return `message ${index} calls ${call.name}, which was not offered`;
        if (open.has(call.id)) return `message ${index} uses the call id ${call.id} twice`;
        open.add(call.id);
      }
    } else if (message.role === 'tool') {
      if (!open.delete(message.toolCallId)) {
        return `message ${index} answers a tool call that was not made just before it`;
      }
    } else if (open.size > 0) {
      return `the tool calls before message ${index} were never answered`;
    }
  }
  if (open.size > 0) return 'the last tool calls were never answered';
  const turns = new Set(episode.verifiedTurns);
  for (const index of turns) {
    const message = messages[index];
    if (message?.role !== 'assistant') return `verified turn ${index} is not an assistant message`;
    if (message.content.trim() === '' && !message.toolCalls?.length) {
      return `verified turn ${index} is empty`;
    }
  }
  return null;
}

function toDatasetMessage(message: EpisodeMessage, train: boolean): DatasetMessage {
  switch (message.role) {
    case 'system':
    case 'user':
      return { role: message.role, content: message.content, train: false };
    case 'tool':
      return {
        role: 'tool',
        tool_call_id: message.toolCallId,
        name: message.name,
        content: message.content,
        train: false,
      };
    case 'assistant':
      return {
        role: 'assistant',
        content: message.content,
        ...(message.reasoning === undefined ? {} : { reasoning_content: message.reasoning }),
        ...(message.toolCalls?.length
          ? {
              tool_calls: message.toolCalls.map((call) => ({
                id: call.id,
                type: 'function' as const,
                function: { name: call.name, arguments: call.arguments },
              })),
            }
          : {}),
        train,
      };
  }
}

function toExample(episode: VerifiedEpisode): DatasetExample {
  const turns = new Set(episode.verifiedTurns);
  const { origin, provenance } = episode;
  return DatasetExampleSchema.parse({
    format: DATASET_EXAMPLE_FORMAT,
    id: episode.id,
    episode_id: episode.id,
    lesson_id: episode.lessonId,
    kind: episode.kind,
    category: episode.category,
    messages: episode.messages.map((message, index) => toDatasetMessage(message, turns.has(index))),
    tools: episode.tools.map((tool) => ({
      type: 'function',
      function: { name: tool.name, description: tool.description, parameters: tool.parameters },
    })),
    chat_template_kwargs: {
      reasoning_strength: episode.template.reasoningStrength,
      ...(episode.template.currentDate === undefined
        ? {}
        : { current_date: episode.template.currentDate }),
    },
    provenance: {
      job_id: provenance.jobId,
      origin:
        origin.kind === 'task'
          ? `task ${origin.taskId} (${origin.split})`
          : `workspace chat ${origin.chatId}, message ${origin.messageId}`,
      ...(provenance.runId === undefined ? {} : { run_id: provenance.runId }),
      ...(provenance.attemptId === undefined ? {} : { attempt_id: provenance.attemptId }),
      ...(provenance.harnessVersion === undefined
        ? {}
        : { harness_version: provenance.harnessVersion }),
      student_model: provenance.studentModel,
      ...(provenance.mentorModel === undefined ? {} : { mentor_model: provenance.mentorModel }),
      ...(provenance.replayFromStep === undefined
        ? {}
        : { replay_from_step: provenance.replayFromStep }),
      ...(provenance.inputHashes === undefined ? {} : { input_hashes: provenance.inputHashes }),
      verified_at: provenance.verifiedAt,
      check_reason: episode.check.reason,
    },
  });
}

/** What a model would be trained on and conditioned by: every word of the conversation. */
function contentOf(example: DatasetExample): string {
  return JSON.stringify({
    messages: example.messages,
    tools: example.tools,
    chat_template_kwargs: example.chat_template_kwargs,
  });
}

function count<T>(items: readonly T[], key: (item: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) counts[key(item)] = (counts[key(item)] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

/**
 * Turns verified episodes into training examples: one per episode, where only the verified
 * assistant turns are targets. Episodes that can't be trained on are left out with the reason;
 * an episode from a split other than train, or holding locked-test content, stops the build,
 * because it means something upstream broke the split boundary.
 */
export function buildTrainingDataset(
  episodes: readonly unknown[],
  options: BuildDatasetOptions,
): BuiltDataset {
  const excluded: { episode_id: string; reason: string }[] = [];
  const kept: { example: DatasetExample; allowsRemote: boolean }[] = [];
  const seen = new Map<string, string>();
  const ids = new Set<string>();

  for (const [position, raw] of episodes.entries()) {
    const parsed = VerifiedEpisodeSchema.safeParse(raw);
    if (!parsed.success) {
      const id = (raw as { id?: unknown } | null)?.id;
      excluded.push({
        episode_id: typeof id === 'string' ? id : `#${position + 1}`,
        reason:
          `not a verified episode: ${parsed.error.issues[0]?.path.join('.') ?? ''} ${parsed.error.issues[0]?.message ?? ''}`.trim(),
      });
      continue;
    }
    const episode = parsed.data;
    if (episode.origin.kind === 'task' && episode.origin.split !== 'train') {
      throw new GuardError(
        'split',
        `Episode ${episode.id} comes from the ${episode.origin.split} split; only train tasks may be trained on.`,
      );
    }
    if (!episode.check.pass) {
      excluded.push({ episode_id: episode.id, reason: 'the checker did not pass it' });
      continue;
    }
    if (options.destination === 'remote' && !episode.sharing.remoteTraining) {
      excluded.push({ episode_id: episode.id, reason: 'its data may not leave this computer' });
      continue;
    }
    const problem = conversationProblem(episode);
    if (problem) {
      excluded.push({ episode_id: episode.id, reason: problem });
      continue;
    }
    const example = toExample(episode);
    const content = contentOf(example);
    const leak = options.leakDetector?.scan(content);
    if (leak?.leaked) {
      throw new GuardError(
        'split',
        `Episode ${episode.id} holds locked-test content (${leak.matchedIds.length} test tasks).`,
      );
    }
    const key = sha256(content);
    const twin = seen.get(key);
    if (twin !== undefined) {
      excluded.push({ episode_id: episode.id, reason: `the same conversation as ${twin}` });
      continue;
    }
    if (ids.has(example.id)) {
      excluded.push({ episode_id: episode.id, reason: 'another episode has the same id' });
      continue;
    }
    seen.set(key, episode.id);
    ids.add(example.id);
    kept.push({ example, allowsRemote: episode.sharing.remoteTraining });
  }

  if (kept.length === 0) {
    throw new DatasetError('None of the episodes can be trained on.', excluded);
  }
  kept.sort((a, b) => a.example.id.localeCompare(b.example.id));
  const examples = kept.map((entry) => entry.example);
  const jsonl = examples.map((example) => `${JSON.stringify(example)}\n`).join('');
  const manifest = DatasetManifestSchema.parse({
    format: DATASET_FORMAT,
    created_at: (options.now?.() ?? new Date()).toISOString(),
    examples_file: EXAMPLES_FILE,
    examples_sha256: sha256(jsonl),
    example_count: examples.length,
    trained_turns: examples.reduce(
      (total, example) => total + example.messages.filter((message) => message.train).length,
      0,
    ),
    categories: count(examples, (example) => example.category),
    kinds: count(examples, (example) => example.kind),
    remote_training_allowed: kept.every((entry) => entry.allowsRemote),
    excluded,
  });
  return { examples, manifest, jsonl };
}

/** Writes `examples.jsonl` and `dataset.json` into a folder. */
export function writeTrainingDataset(dir: string, dataset: BuiltDataset): void {
  mkdirSync(dir, { recursive: true });
  writeFileAtomic(join(dir, EXAMPLES_FILE), dataset.jsonl);
  writeFileAtomic(
    join(dir, DATASET_MANIFEST_FILE),
    `${JSON.stringify(dataset.manifest, null, 2)}\n`,
  );
}

/** Reads a dataset folder back, checking the examples against the manifest's hash and count. */
export function readTrainingDataset(dir: string): BuiltDataset {
  const manifest = DatasetManifestSchema.parse(
    JSON.parse(readFileSync(join(dir, DATASET_MANIFEST_FILE), 'utf8')),
  );
  const jsonl = readFileSync(join(dir, EXAMPLES_FILE), 'utf8');
  if (sha256(jsonl) !== manifest.examples_sha256) {
    throw new Error("The examples file doesn't match the dataset's manifest.");
  }
  const examples = jsonl
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => DatasetExampleSchema.parse(JSON.parse(line)));
  if (examples.length !== manifest.example_count) {
    throw new Error(
      `The dataset should have ${manifest.example_count} examples, not ${examples.length}.`,
    );
  }
  return { examples, manifest, jsonl };
}
