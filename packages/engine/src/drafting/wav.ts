import { MUSE_VOICE_TRANSCRIBE } from '@architect/shared';

/*
 * WAV recordings made ready for Muse Voice Transcribe (decision 087), in plain code with no
 * decoder to install: any PCM or float WAV is mixed to one channel, brought to a rate the
 * service takes, written as 16-bit PCM and cut into pieces it accepts in one request.
 */

export interface WavAudio {
  sampleRate: number;
  channels: number;
  /** Each frame's channels averaged, from -1 to 1. */
  samples: Float32Array;
}

/** The longest piece sent in one request, kept under the service's ten minutes. */
export const PIECE_SECONDS = 590;

/** The rate a recording at any other rate is brought to. */
const TARGET_RATE = 16_000;

function fail(name: string, why: string): never {
  throw new Error(`${name} can't be read: ${why}`);
}

/**
 * The speech of a WAV file, mixed to one channel. 8, 16, 24 and 32-bit PCM and 32 or 64-bit
 * float are read; anything else is refused with what to do.
 */
export function readWav(bytes: Uint8Array, name: string): WavAudio {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));
  if (bytes.byteLength < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') {
    fail(name, 'it is not a WAV file. Export the recording as WAV, then add that.');
  }
  let format: { code: number; channels: number; rate: number; bits: number } | undefined;
  let data: Uint8Array | undefined;
  for (let at = 12; at + 8 <= bytes.byteLength;) {
    const id = tag(at);
    const size = view.getUint32(at + 4, true);
    const body = at + 8;
    if (id === 'fmt ' && size >= 16) {
      let code = view.getUint16(body, true);
      // WAVE_FORMAT_EXTENSIBLE names the real format in the first two bytes of its subformat.
      if (code === 0xfffe && size >= 26) code = view.getUint16(body + 24, true);
      format = {
        code,
        channels: view.getUint16(body + 2, true),
        rate: view.getUint32(body + 4, true),
        bits: view.getUint16(body + 14, true),
      };
    } else if (id === 'data') {
      data = bytes.subarray(body, Math.min(body + size, bytes.byteLength));
    }
    at = body + size + (size % 2);
  }
  if (format === undefined || data === undefined) fail(name, 'the WAV file has no audio in it.');
  const { code, channels, rate, bits } = format;
  const pcm = code === 1 && [8, 16, 24, 32].includes(bits);
  const float = code === 3 && (bits === 32 || bits === 64);
  if (!(pcm || float) || channels < 1 || rate < 8_000) {
    fail(name, 'its audio is compressed. Export it as uncompressed (PCM) WAV, then add that.');
  }
  const width = bits / 8;
  const frames = Math.floor(data.byteLength / (width * channels));
  const audio = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const sample = (at: number): number => {
    if (float) return bits === 32 ? audio.getFloat32(at, true) : audio.getFloat64(at, true);
    switch (bits) {
      case 8:
        return (audio.getUint8(at) - 128) / 128;
      case 16:
        return audio.getInt16(at, true) / 32_768;
      case 24:
        return ((audio.getUint8(at + 2) << 24) | (audio.getUint16(at, true) << 8)) / 2_147_483_648;
      default:
        return audio.getInt32(at, true) / 2_147_483_648;
    }
  };
  const samples = new Float32Array(frames);
  for (let frame = 0; frame < frames; frame += 1) {
    let sum = 0;
    for (let channel = 0; channel < channels; channel += 1) {
      sum += sample((frame * channels + channel) * width);
    }
    samples[frame] = sum / channels;
  }
  return { sampleRate: rate, channels, samples };
}

/** How long a recording lasts, in seconds. */
export function secondsOf(audio: WavAudio): number {
  return audio.samples.length / audio.sampleRate;
}

/**
 * The recording at a rate the service takes: as it is at 16 or 24 kHz, otherwise 16 kHz. Going
 * down, each new sample is the mean of the ones it covers, which keeps out most of the sound
 * above the new rate; going up, it is drawn between its neighbours.
 */
function atServiceRate(audio: WavAudio): WavAudio {
  const rates: readonly number[] = MUSE_VOICE_TRANSCRIBE.sampleRates;
  if (rates.includes(audio.sampleRate)) return audio;
  const ratio = audio.sampleRate / TARGET_RATE;
  const source = audio.samples;
  const length = Math.floor(source.length / ratio);
  const samples = new Float32Array(length);
  for (let at = 0; at < length; at += 1) {
    if (ratio > 1) {
      const from = Math.floor(at * ratio);
      const to = Math.max(from + 1, Math.min(source.length, Math.floor((at + 1) * ratio)));
      let sum = 0;
      for (let i = from; i < to; i += 1) sum += source[i] ?? 0;
      samples[at] = sum / (to - from);
    } else {
      const position = at * ratio;
      const below = Math.floor(position);
      const weight = position - below;
      samples[at] =
        (source[below] ?? 0) * (1 - weight) +
        (source[Math.min(below + 1, source.length - 1)] ?? 0) * weight;
    }
  }
  return { sampleRate: TARGET_RATE, channels: 1, samples };
}

/** Mono 16-bit PCM samples as a WAV file. */
export function wavBytes(samples: Float32Array, sampleRate: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const write = (at: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) bytes[at + i] = text.charCodeAt(i);
  };
  write(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  write(8, 'WAVE');
  write(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let at = 0; at < samples.length; at += 1) {
    const value = Math.max(-1, Math.min(1, samples[at] ?? 0));
    view.setInt16(44 + at * 2, Math.round(value * 32_767), true);
  }
  return bytes;
}

/** One request's worth of a recording, with where it starts. */
export interface Piece {
  startSeconds: number;
  /** Whole seconds, as the service bills them. */
  billedSeconds: number;
  wav: Uint8Array<ArrayBuffer>;
}

/** A recording as the requests that carry it: mono 16-bit WAV, each under ten minutes. */
export function piecesOf(audio: WavAudio): Piece[] {
  const ready = atServiceRate(audio);
  const size = PIECE_SECONDS * ready.sampleRate;
  const pieces: Piece[] = [];
  for (let from = 0; from < ready.samples.length; from += size) {
    const samples = ready.samples.subarray(from, Math.min(from + size, ready.samples.length));
    pieces.push({
      startSeconds: from / ready.sampleRate,
      billedSeconds: Math.floor(samples.length / ready.sampleRate),
      wav: wavBytes(samples, ready.sampleRate),
    });
  }
  return pieces;
}
