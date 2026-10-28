import { describe, expect, it } from 'vitest';
import {
  formatBytes,
  formatDuration,
  formatPercent,
  formatUsd,
} from '../../../src/renderer/src/lib/format';
import {
  capitalized,
  mentorIntro,
  quantizationLabel,
  shortModelName,
  studentIntro,
  studentLabel,
  studentName,
  setupName,
  setupSource,
} from '../../../src/renderer/src/lib/names';
import {
  detectPlatform,
  deviceInSentence,
  deviceLabel,
} from '../../../src/renderer/src/lib/platform';

describe('model names', () => {
  it('shortens preset labels to the names the UI uses', () => {
    expect(shortModelName('Muse Spark 1.3')).toBe('Spark');
    expect(shortModelName('Muse Spark 1.3, contributor tier')).toBe('Spark');
    expect(shortModelName('Muse Spark Open on Baseten')).toBe('Spark Open');
    expect(shortModelName('Muse Glimmer on this computer')).toBe('Glimmer');
    expect(shortModelName('Claude Code')).toBe('Claude Code');
  });

  it('labels the student from its preset, or by model id', () => {
    const local = {
      runtime: 'ollama' as const,
      baseUrl: 'http://127.0.0.1:11434',
      model: 'muse-glimmer:30b',
      contextLength: 16_384,
    };
    expect(studentLabel(local)).toBe('Muse Glimmer');
    expect(studentName(local)).toBe('Glimmer');
    expect(studentLabel({ ...local, model: 'qwen3:8b' })).toBe('qwen3:8b');
  });

  it('introduces each model by its role, the same way everywhere', () => {
    expect(mentorIntro('Spark')).toBe('Spark, the mentor');
    expect(studentIntro('Glimmer')).toBe("Glimmer, your agent's model");
    expect(capitalized("your agent's model")).toBe("Your agent's model");
  });

  it('writes a quantization as the number of bits people know it by', () => {
    expect(quantizationLabel('Q4_K_M')).toBe('4-bit');
    expect(quantizationLabel('q8_0')).toBe('8-bit');
    expect(quantizationLabel('IQ3_XS')).toBe('3-bit');
    expect(quantizationLabel('F16')).toBe('16-bit');
    expect(quantizationLabel('MXFP4')).toBe('MXFP4');
  });
});

describe('platform copy', () => {
  it('says "This Mac" on macOS and "This computer" elsewhere', () => {
    const mac = detectPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) Electron/45.0.0');
    const windows = detectPlatform('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Electron/45.0.0');
    const linux = detectPlatform('Mozilla/5.0 (X11; Linux x86_64) Electron/45.0.0');
    expect([mac, windows, linux]).toEqual(['darwin', 'win32', 'linux']);
    expect(deviceLabel(mac)).toBe('This Mac');
    expect(deviceLabel(windows)).toBe('This computer');
    expect(deviceInSentence(linux)).toBe('this computer');
  });
});

describe('formats', () => {
  it('writes money, time and size the way the design does', () => {
    expect(formatUsd(5)).toBe('$5');
    expect(formatUsd(2.4)).toBe('$2.40');
    expect(formatDuration(72 * 60_000)).toBe('1 h 12 min');
    expect(formatDuration(180 * 60_000)).toBe('3 h');
    expect(formatDuration(158 * 60_000)).toBe('2 h 38 min');
    expect(formatDuration(120 * 60_000)).toBe('2 h');
    expect(formatDuration(14 * 60_000)).toBe('14 min');
    expect(formatDuration(40_000)).toBe('40 s');
    expect(formatBytes(18 * 1024 ** 3)).toBe('18 GB');
    expect(formatBytes(4.6 * 1024 ** 3)).toBe('4.6 GB');
    expect(formatBytes(236 * 1024 ** 2)).toBe('236 MB');
    expect(formatPercent({ pass: 31, total: 40 })).toBe('78%');
    expect(formatPercent({ pass: 0, total: 0 })).toBe('0%');
  });
});

describe('setupName', () => {
  it('names a kept setup by where it came from', () => {
    expect(setupName({})).toBe('the starting setup');
    expect(setupName({ round: 1, draft: true })).toBe('the first draft');
    expect(setupName({ round: 7 })).toBe('the setup from round 7');
  });
});

describe('setupSource', () => {
  it('says what a setup comes from without implying training stopped there', () => {
    expect(setupSource({ round: 7 }, 'Spark')).toBe('Round 7 was the last change Spark kept.');
    expect(setupSource({ round: 1, draft: true }, 'Spark')).toBe(
      'Spark wrote them in one go and kept no later change.',
    );
    expect(setupSource({}, 'Spark')).toBe(
      'They are the ones it started with, and Spark kept no change.',
    );
  });
});
