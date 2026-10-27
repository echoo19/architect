import { describe, expect, it } from 'vitest';
import { isLoopbackUrl } from '../src/loopback';

describe('isLoopbackUrl', () => {
  it('accepts localhost, the whole 127/8 block and ::1', () => {
    for (const url of [
      'http://localhost:11434',
      'https://localhost/v1',
      'HTTP://LOCALHOST:8080',
      'http://127.0.0.1:11434',
      'http://127.1.2.3',
      'http://127.255.255.254:80/v1',
      'http://[::1]:8080/v1',
      'http://[::1]',
      'http://[0:0:0:0:0:0:0:1]:9000',
    ]) {
      expect(isLoopbackUrl(url), url).toBe(true);
    }
  });

  it('sees through shorthand spellings of 127.0.0.1', () => {
    expect(isLoopbackUrl('http://127.1')).toBe(true);
    expect(isLoopbackUrl('http://2130706433/')).toBe(true);
    expect(isLoopbackUrl('http://0x7f.0.0.1/')).toBe(true);
  });

  it('rejects hosts that only look like loopback', () => {
    for (const url of [
      'http://localhost.example.com',
      'http://127.0.0.1.evil.com',
      'http://foo.localhost',
      'http://localhost./',
      'http://127.0.0.1@evil.com/',
      'http://evil.com/127.0.0.1',
      'http://128.0.0.1',
      'http://126.255.255.255',
    ]) {
      expect(isLoopbackUrl(url), url).toBe(false);
    }
  });

  it('rejects other private and wildcard addresses', () => {
    for (const url of [
      'http://0.0.0.0',
      'http://10.0.0.5:11434',
      'http://192.168.1.20:11434',
      'http://169.254.1.1',
      'http://[::2]',
      'http://[::]',
      'http://[::ffff:127.0.0.1]',
      'http://[fe80::1]',
    ]) {
      expect(isLoopbackUrl(url), url).toBe(false);
    }
  });

  it('rejects public hosts', () => {
    expect(isLoopbackUrl('https://api.meta.ai/v1')).toBe(false);
    expect(isLoopbackUrl('https://inference.baseten.co/v1')).toBe(false);
  });

  it('treats anything unparseable as not loopback', () => {
    for (const url of [
      '',
      'not a url',
      'localhost:11434',
      '127.0.0.1:8080',
      'http://',
      '//localhost',
    ]) {
      expect(isLoopbackUrl(url), url).toBe(false);
    }
    expect(isLoopbackUrl('http://127.0.0.256')).toBe(false);
  });

  it('accepts URL objects', () => {
    expect(isLoopbackUrl(new URL('http://127.0.0.1:1234'))).toBe(true);
    expect(isLoopbackUrl(new URL('https://example.com'))).toBe(false);
  });
});
