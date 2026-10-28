import { describe, expect, it } from 'vitest';
import {
  formatBytes,
  formatDuration,
  formatPercent,
  formatUsd,
  shortPath,
} from '../../../src/renderer/src/lib/format';
import {
  activeVersionName,
  agentModelName,
  capitalized,
  mentorIntro,
  mentorIsLocal,
  quantizationLabel,
  shortModelName,
  studentIntro,
  studentLabel,
  studentName,
  setupName,
} from '../../../src/renderer/src/lib/names';
import {
  detectPlatform,
  deviceInSentence,
  deviceLabel,
} from '../../../src/renderer/src/lib/platform';

describe('model names', () => {
  it('knows a mentor on this computer from one in the cloud', () => {
    const mentor = {
      kind: 'model' as const,
      provider: 'meta' as const,
      label: 'Muse Spark 1.3',
      baseUrl: 'https://api.meta.ai/v1',
      model: 'muse-spark-1.3',
      reasoningEffort: 'medium' as const,
      secretRef: 'meta',
    };
    expect(mentorIsLocal(mentor)).toBe(false);
    expect(
      mentorIsLocal({ ...mentor, provider: 'ollama', baseUrl: 'http://127.0.0.1:11434/v1' }),
    ).toBe(true);
    expect(
      mentorIsLocal({ ...mentor, provider: 'other', baseUrl: 'http://localhost:8080/v1' }),
    ).toBe(true);
    expect(
      mentorIsLocal({ ...mentor, provider: 'other', baseUrl: 'https://llm.example.com/v1' }),
    ).toBe(false);
  });

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

  it("names an agent's model Glimmer for any of its builds, or by the id of any other model chosen", () => {
    expect(agentModelName({ label: 'Glimmer', model: 'muse-glimmer:30b' })).toBe('Glimmer');
    expect(agentModelName({ label: 'Glimmer', model: 'muse-glimmer:30b-iq2' })).toBe('Glimmer');
    expect(agentModelName({ label: 'Glimmer', model: 'qwen3:8b' })).toBe('qwen3:8b');
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
    expect(formatBytes(48_900)).toBe('48 KB');
    expect(formatBytes(12)).toBe('1 KB');
    expect(shortPath('C:\\Users\\dana\\Documents\\Larchwood\\Records')).toBe(
      '…\\Larchwood\\Records',
    );
    expect(shortPath('/Users/dana/Records')).toBe('…/dana/Records');
    expect(shortPath('D:\\Records')).toBe('D:\\Records');
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

describe('activeVersionName', () => {
  it('names the version an agent answers with, as the Teaching tab does', () => {
    expect(activeVersionName({ activeVersion: 2, manifest: { harness: { round: 7 } } })).toBe(
      'Version 2',
    );
  });

  it('names the setup of a graduate from before versions by where it came from', () => {
    expect(activeVersionName({ activeVersion: null, manifest: { harness: { round: 7 } } })).toBe(
      'The setup from round 7',
    );
  });
});
