import { AdapterError, type MentorConfig } from '@architect/shared';
import { afterEach, describe, expect, it } from 'vitest';
import * as api from '../src';
import { createMentor, createStudent } from '../src';
import { mentorConfig, studentEndpoint } from './helpers/configs';
import { fakeOllama } from './helpers/student';
import { sendJson, startServer, stopServers } from './helpers/server';

afterEach(stopServers);

describe('createMentor', () => {
  it('builds a model mentor from a model config', () => {
    const config = mentorConfig('baseten-spark-open');
    const mentor = createMentor(config, { apiKey: 'key-123456' });
    expect(mentor).toMatchObject({
      kind: 'model',
      provider: 'baseten',
      model: config.model,
      label: config.label,
    });
  });

  it('builds an Anthropic mentor on the Messages API and a key-less one for a local model', () => {
    const anthropic = createMentor(mentorConfig('anthropic-haiku'), { apiKey: 'key-123456' });
    expect(anthropic).toMatchObject({ kind: 'model', provider: 'anthropic' });
    const local = createMentor(
      mentorConfig('meta-spark', {
        provider: 'ollama',
        baseUrl: 'http://127.0.0.1:11434',
        model: 'granite4.2:8b',
        secretRef: undefined,
      }),
    );
    expect(local).toMatchObject({ provider: 'ollama', model: 'granite4.2:8b' });
    expect(local.estimateCostUsd({ inputTokens: 1_000_000, outputTokens: 1_000_000 })).toBe(0);
  });

  it('says so, in plain words, for a coding agent', () => {
    const config: MentorConfig = {
      kind: 'coding_agent',
      agent: 'claude_code',
      label: 'Claude Code',
    };
    expect(() => createMentor(config, { apiKey: 'key-123456' })).toThrow(AdapterError);
    expect(() => createMentor(config, { apiKey: 'key-123456' })).toThrow(
      "Claude Code can't be used as a mentor yet. Choose a model API instead.",
    );
  });
});

describe('createStudent', () => {
  it('picks the Ollama adapter for the ollama runtime', async () => {
    const server = await startServer(fakeOllama({ models: [] }));
    const student = createStudent(studentEndpoint('ollama-glimmer', { baseUrl: server.url }));
    await student.testConnection();
    expect(server.requests.map((request) => request.path)).toEqual(['/api/version', '/api/tags']);
    expect(student.label).toBe('Ollama');
  });

  it('picks the OpenAI-compatible adapter otherwise', async () => {
    const server = await startServer((_request, res) => sendJson(res, 200, { data: [] }));
    const endpoint = studentEndpoint('together-glimmer', { baseUrl: `${server.url}/v1` });
    const student = createStudent(endpoint, { apiKey: 'key-123456', retry: { maxAttempts: 1 } });
    await student.testConnection();
    expect(server.requests[0]).toMatchObject({ method: 'GET', path: '/v1/models' });
    expect(server.requests[0]?.headers.authorization).toBe('Bearer key-123456');
  });

  it('reports a student as local only when it is on this machine', () => {
    expect(createStudent(studentEndpoint('ollama-glimmer')).isLocal).toBe(true);
    expect(createStudent(studentEndpoint('together-glimmer')).isLocal).toBe(false);
    expect(
      createStudent(studentEndpoint('together-glimmer', { baseUrl: 'http://localhost:8080/v1' }))
        .isLocal,
    ).toBe(true);
  });
});

describe('the public API', () => {
  it('exports what the app and the engine use, and nothing internal', () => {
    expect(Object.keys(api).sort()).toEqual([
      'MentorReplyError',
      'createMentor',
      'createModelMentor',
      'createOllamaStudent',
      'createOpenAICompatibleStudent',
      'createStudent',
      'isLoopbackUrl',
      'listModels',
      'listOllamaModels',
      'ollamaVersion',
      'pullOllamaModel',
      'verifyKey',
    ]);
  });
});
