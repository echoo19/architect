import { MUSE_VOICE_TRANSCRIBE, type Transcriber, type Transcription } from '@architect/shared';
import { z } from 'zod';
import type { AdapterDeps } from '../deps';
import { createHttpClient } from '../http/client';

/*
 * Muse Voice Transcribe on Meta's Model API (decision 087): one WAV file in a multipart form, its
 * turns back with a speaker label each. The request shape is Meta's file endpoint as its docs
 * give it (docs/MODELS.md).
 */

const TurnWire = z.object({
  transcript: z.string(),
  speaker: z.string().optional(),
});

const TranscribeWire = z.object({
  transcript: z.string(),
  audioDurationMs: z.number().int().min(0),
  turns: z.array(TurnWire),
});

/** A recording can take as long as it lasts to transcribe; ten minutes of audio is the most. */
const TRANSCRIBE_TIMEOUT_MS = 600_000;

export interface TranscriberDeps extends AdapterDeps {
  /** Read from the app's secret store by the caller. Sent to Meta only and never logged. */
  apiKey: string;
}

export function createMuseVoiceTranscriber(deps: TranscriberDeps): Transcriber {
  const { apiKey } = deps;
  const http = createHttpClient({
    baseUrl: MUSE_VOICE_TRANSCRIBE.baseUrl,
    service: MUSE_VOICE_TRANSCRIBE.label,
    headers: { authorization: `Bearer ${apiKey}` },
    secrets: [apiKey],
    fetch: deps.fetch,
    network: deps.network,
    retry: deps.retry,
  });
  return {
    label: MUSE_VOICE_TRANSCRIBE.label,
    model: MUSE_VOICE_TRANSCRIBE.model,
    async transcribe(wav, signal): Promise<Transcription> {
      const form = () => {
        const body = new FormData();
        body.append(
          'request',
          new Blob(
            [
              JSON.stringify({
                model: MUSE_VOICE_TRANSCRIBE.model,
                audioEncoding: 'WAV',
                mode: 'DIARIZATION',
              }),
            ],
            { type: 'application/json' },
          ),
        );
        body.append('audio', new Blob([wav], { type: 'audio/wav' }), 'recording.wav');
        return body;
      };
      // Meta doesn't bill a failed request or a 429, so one that can be retried is sent again.
      const reply = await http.withRetries(
        () =>
          http.postForm(MUSE_VOICE_TRANSCRIBE.path, form(), TranscribeWire, {
            signal,
            model: MUSE_VOICE_TRANSCRIBE.model,
            timeoutMs: TRANSCRIBE_TIMEOUT_MS,
          }),
        signal,
      );
      const turns = reply.turns
        .map((turn) => ({
          text: turn.transcript.trim(),
          ...(turn.speaker === undefined ? {} : { speaker: turn.speaker }),
        }))
        .filter((turn) => turn.text !== '');
      return {
        turns:
          turns.length > 0 || reply.transcript.trim() === ''
            ? turns
            : [{ text: reply.transcript.trim() }],
        durationMs: reply.audioDurationMs,
      };
    },
  };
}
