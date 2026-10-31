import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createMuseVoiceTranscriber } from '@architect/adapters';
import { GuardError, MUSE_VOICE_TRANSCRIBE, type Job } from '@architect/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JobRecordings, transcriptionUsd } from '../src/drafting/recordings';
import { JobStudy } from '../src/drafting/studying';
import { PIECE_SECONDS, piecesOf, readWav } from '../src/drafting/wav';
import type { EngineHostDeps } from '../src/loop/deps';
import { defaultJob } from './fakes/job';
import { draftingWorld, TEACHER, type DraftingWorld } from './support/drafting-world';

/*
 * A taught organization's recordings, transcribed for the study (decision 087), against a fake
 * Muse Voice endpoint: the transcript kept as the organization's file and quoted by the study,
 * the cap, consent and the job's setting, an organization kept for the final test refused, and
 * the key never written anywhere.
 */

const KEY = 'LLM_test-key-0123456789abcdef';
const SAID = 'Refunds over fifty dollars need a manager on the call.';

/** A stereo 16-bit WAV at 44.1 kHz, as a phone or a laptop records one. */
function stereoWav(seconds: number, rate = 44_100): Buffer {
  const frames = Math.round(seconds * rate);
  const bytes = Buffer.alloc(44 + frames * 4);
  bytes.write('RIFF', 0, 'ascii');
  bytes.writeUInt32LE(36 + frames * 4, 4);
  bytes.write('WAVE', 8, 'ascii');
  bytes.write('fmt ', 12, 'ascii');
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(2, 22);
  bytes.writeUInt32LE(rate, 24);
  bytes.writeUInt32LE(rate * 4, 28);
  bytes.writeUInt16LE(4, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36, 'ascii');
  bytes.writeUInt32LE(frames * 4, 40);
  for (let frame = 0; frame < frames; frame += 1) {
    const value = Math.round(Math.sin((frame / rate) * 2 * Math.PI * 220) * 8_000);
    bytes.writeInt16LE(value, 44 + frame * 4);
    bytes.writeInt16LE(value, 46 + frame * 4);
  }
  return bytes;
}

interface Sent {
  url: string;
  authorization: string | null;
  settings: Record<string, unknown>;
  audio: Buffer;
}

/** Meta's file endpoint as its docs describe it, answering every request alike. */
function fakeMeta(reply: (sent: Sent) => Response) {
  const sent: Sent[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const form = init?.body as FormData;
    const settings = form.get('request') as Blob;
    const audio = form.get('audio') as Blob;
    const request: Sent = {
      url: String(input),
      authorization: new Headers(init?.headers).get('authorization'),
      settings: JSON.parse(await settings.text()) as Record<string, unknown>,
      audio: Buffer.from(await audio.arrayBuffer()),
    };
    sent.push(request);
    return reply(request);
  };
  return { sent, fetch };
}

/** A reply as Meta gives it: the audio's length as the WAV says it, and two speakers. */
function transcribed(sent: Sent): Response {
  const audio = readWav(new Uint8Array(sent.audio), 'piece.wav');
  const durationMs = Math.round((audio.samples.length / audio.sampleRate) * 1000);
  return Response.json({
    sessionId: 'session-1',
    transcript: `Hello, thanks for calling. ${SAID}`,
    audioDurationMs: durationMs,
    turns: [
      { turnId: 0, startMs: 0, endMs: 900, transcript: 'Hello, thanks for calling.', speaker: 'A' },
      { turnId: 1, startMs: 900, endMs: durationMs, transcript: SAID, speaker: 'B' },
    ],
  });
}

function fieldJob(): Job {
  return defaultJob({
    id: 'desk',
    name: 'Academy desk',
    description: 'Answer families from the academy files.',
    taskTypes: [{ id: 'answer', label: 'Answer' }],
    mentor: TEACHER,
    startingHarness: { kind: 'blank' },
    organizations: [
      { id: 'northside', name: 'Northside Prep', synthetic: true, role: 'train' },
      { id: 'harbor', name: 'Harbor Learning', synthetic: true, role: 'transfer' },
    ],
  });
}

let world: DraftingWorld;
let job: Job;
let meta: ReturnType<typeof fakeMeta>;
let deps: EngineHostDeps;

function recordings(capUsd?: number): JobRecordings {
  return new JobRecordings({
    jobs: world.jobs,
    paths: world.paths,
    deps,
    clock: world.clock,
    ...(capUsd === undefined ? {} : { capUsd }),
  });
}

beforeEach(async () => {
  world = draftingWorld();
  job = await world.jobs.save(fieldJob());
  for (const org of ['northside', 'harbor']) {
    const dir = world.paths.orgDataDir(job.id, org);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'policy.md'), '# Policy\n\nAnswer from the files.\n');
  }
  meta = fakeMeta(transcribed);
  deps = {
    ...world.deps,
    adapters: {
      ...world.deps.adapters,
      createTranscriber: ({ apiKey }) => createMuseVoiceTranscriber({ apiKey, fetch: meta.fetch }),
    },
    secrets: { get: async (ref) => (ref === 'meta' ? KEY : undefined) },
  };
});

afterEach(() => {
  vi.restoreAllMocks();
  world.cleanup();
});

describe('transcribing a taught organization’s recordings', () => {
  it('keeps the transcript as its file, which the study then quotes', async () => {
    const wav = world.attach('Support call 1.wav', stereoWav(3));
    const service = recordings();
    const quote = await service.quote(job.id, 'northside', [wav]);
    expect(quote.files.map((file) => [file.name, file.seconds, file.done])).toEqual([
      ['Support call 1.wav', 3, false],
    ]);
    expect(quote.usd).toBeCloseTo(transcriptionUsd(3));
    expect(meta.sent).toHaveLength(0);

    await service.share(job.id, true);
    const plan = await service.transcribe(job.id, {
      org: 'northside',
      paths: [wav],
      consent: true,
    });

    // One request, in the shape Meta's docs give, of mono 16-bit audio at a rate it takes.
    expect(meta.sent).toHaveLength(1);
    const [request] = meta.sent;
    expect(request?.url).toBe(`${MUSE_VOICE_TRANSCRIBE.baseUrl}${MUSE_VOICE_TRANSCRIBE.path}`);
    expect(request?.authorization).toBe(`Bearer ${KEY}`);
    expect(request?.settings).toEqual({
      model: 'muse-voice-transcribe-1.0',
      audioEncoding: 'WAV',
      mode: 'DIARIZATION',
    });
    const audio = readWav(new Uint8Array(request?.audio ?? Buffer.alloc(0)), 'sent.wav');
    expect([audio.channels, audio.sampleRate]).toEqual([1, 16_000]);
    expect(request?.audio.readUInt16LE(34)).toBe(16);

    // Kept as the organization's text file, with the recording's hash and its cost.
    const dir = world.paths.orgDataDir(job.id, 'northside');
    const text = readFileSync(join(dir, 'support-call-1.transcript.txt'), 'utf8');
    expect(text).toContain(`B: ${SAID}`);
    expect(plan.recordings?.transcripts).toEqual([
      expect.objectContaining({
        org: 'northside',
        source: 'Support call 1.wav',
        file: 'support-call-1.transcript.txt',
        sourceSha256: createHash('sha256').update(readFileSync(wav)).digest('hex'),
        seconds: 3,
        model: 'muse-voice-transcribe-1.0',
      }),
    ]);

    // The same recording again is not sent again.
    const again = await service.quote(job.id, 'northside', [wav]);
    expect(again.files[0]?.done).toBe(true);
    expect(again.usd).toBe(0);
    await service.transcribe(job.id, { org: 'northside', paths: [wav], consent: true });
    expect(meta.sent).toHaveLength(1);

    // The study reads it like any file, and a passage from it is found there.
    world.mentor.script = () => ({
      skills: [
        {
          taskType: 'answer',
          text: 'Answer a family from the files.',
          needs: ['policy.md'],
          steps: ['Read policy.md.'],
          quotes: [],
        },
      ],
      connections: [],
      rules: [
        {
          text: 'Large refunds need a manager.',
          quotes: [{ org: 'northside', file: 'support-call-1.transcript.txt', passage: SAID }],
        },
      ],
      differences: [],
      questions: [],
      outOfScope: [],
    });
    const study = new JobStudy({ jobs: world.jobs, paths: world.paths, deps, clock: world.clock });
    const state = await study.study(job.id);
    expect(state.brief?.rules[0]?.quotes).toEqual([
      { org: 'northside', file: 'support-call-1.transcript.txt', passage: SAID },
    ]);
    expect(state.brief?.dropped).toBe(0);
    expect(JSON.stringify(world.mentor.requests)).toContain(SAID);
  });

  it('refuses an organization kept for the final test, before reading or sending anything', async () => {
    await recordings().share(job.id, true);
    const missing = join(world.root, 'never-read.wav');
    for (const attempt of [
      recordings().quote(job.id, 'harbor', [missing]),
      recordings().transcribe(job.id, { org: 'harbor', paths: [missing], consent: true }),
    ]) {
      const error = await attempt.catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(GuardError);
      expect((error as GuardError).guard).toBe('split');
    }
    expect(meta.sent).toHaveLength(0);
    expect(readdirSync(world.paths.orgDataDir(job.id, 'harbor'))).toEqual(['policy.md']);
  });

  it('keeps under its cap: a batch that could cost more is never sent', async () => {
    const wav = world.attach('meeting.wav', stereoWav(5));
    const service = recordings(transcriptionUsd(4));
    await service.share(job.id, true);
    const error = await service
      .transcribe(job.id, { org: 'northside', paths: [wav], consent: true })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(GuardError);
    expect((error as GuardError).guard).toBe('budget');
    expect(meta.sent).toHaveLength(0);
  });

  it("sends nothing until the job's setting allows it and the person agrees", async () => {
    const wav = world.attach('walkthrough.wav', stereoWav(1));
    const service = recordings();
    await expect(
      service.transcribe(job.id, { org: 'northside', paths: [wav], consent: true }),
    ).rejects.toThrow('keeps its recordings on this computer');
    await service.share(job.id, true);
    await expect(
      service.transcribe(job.id, { org: 'northside', paths: [wav], consent: false }),
    ).rejects.toThrow('only once you agree');
    expect(meta.sent).toHaveLength(0);
  });

  it('says a video or compressed recording needs a WAV export', async () => {
    const video = world.attach('lesson.mp4', Buffer.from('not audio'));
    await expect(recordings().quote(job.id, 'northside', [video])).rejects.toThrow(
      /Export its audio as a WAV file/,
    );
    const fake = world.attach('call.wav', Buffer.from('ID3 not a wav'));
    await expect(recordings().quote(job.id, 'northside', [fake])).rejects.toThrow(/not a WAV file/);
  });

  it('never writes the key, in an error, a log or a file', async () => {
    const logged: unknown[][] = [];
    for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        logged.push(args);
      });
    }
    meta = fakeMeta(() =>
      Response.json({ error: { message: `Bad key ${KEY}`, type: 'auth' } }, { status: 401 }),
    );
    const wav = world.attach('call.wav', stereoWav(1));
    const service = recordings();
    await service.share(job.id, true);
    const error = await service
      .transcribe(job.id, { org: 'northside', paths: [wav], consent: true })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect(String((error as Error).message)).not.toContain(KEY);
    expect(JSON.stringify(error)).not.toContain(KEY);
    expect(JSON.stringify(logged)).not.toContain(KEY);

    meta = fakeMeta(transcribed);
    await service.transcribe(job.id, { org: 'northside', paths: [wav], consent: true });
    expect(JSON.stringify(logged)).not.toContain(KEY);
    expect(readFileSync(world.paths.recordingsFile(job.id), 'utf8')).not.toContain(KEY);
    const dir = world.paths.orgDataDir(job.id, 'northside');
    for (const name of readdirSync(dir)) {
      expect(readFileSync(join(dir, name), 'utf8')).not.toContain(KEY);
    }
  });
});

describe('WAV recordings made ready to send', () => {
  it('reads 24-bit audio and cuts a long recording into pieces under ten minutes', () => {
    const rate = 8_000;
    const frames = rate * (PIECE_SECONDS + 20);
    const bytes = Buffer.alloc(44 + frames * 3);
    bytes.write('RIFF', 0, 'ascii');
    bytes.writeUInt32LE(36 + frames * 3, 4);
    bytes.write('WAVE', 8, 'ascii');
    bytes.write('fmt ', 12, 'ascii');
    bytes.writeUInt32LE(16, 16);
    bytes.writeUInt16LE(1, 20);
    bytes.writeUInt16LE(1, 22);
    bytes.writeUInt32LE(rate, 24);
    bytes.writeUInt32LE(rate * 3, 28);
    bytes.writeUInt16LE(3, 32);
    bytes.writeUInt16LE(24, 34);
    bytes.write('data', 36, 'ascii');
    bytes.writeUInt32LE(frames * 3, 40);
    bytes.writeIntLE(-4_194_304, 44, 3);
    const audio = readWav(new Uint8Array(bytes), 'long.wav');
    expect(audio.samples[0]).toBeCloseTo(-0.5);
    const pieces = piecesOf(audio);
    expect(pieces.map((piece) => [piece.startSeconds, piece.billedSeconds])).toEqual([
      [0, PIECE_SECONDS],
      [PIECE_SECONDS, 20],
    ]);
    expect(pieces.every((piece) => piece.wav.byteLength <= MUSE_VOICE_TRANSCRIBE.maxBytes)).toBe(
      true,
    );
  });
});
