import type { PublishProgress } from '@architect/shared';
import { describe, expect, it } from 'vitest';
import {
  bareUrl,
  installCommand,
  repositoryOf,
  sentText,
  shortCommit,
  stageText,
  tokenSourceText,
} from '../../../src/renderer/src/hub/labels';

const COMMIT = '3f1c9e2a4b5c6d7e8f9011223344556677889900';

describe('Hugging Face, in the words the screens use', () => {
  it('says where the token comes from, never what it is', () => {
    expect(tokenSourceText('saved')).toBe('Token saved');
    expect(tokenSourceText('HF_TOKEN')).toBe('Uses HF_TOKEN from this computer');
    expect(tokenSourceText('token_file')).toBe('Uses the token from hf auth login');
    expect(tokenSourceText(null)).toBe('No token');
  });

  it('takes a repository as it is typed: by name, with hf://, or as its page', () => {
    expect(repositoryOf('dana/returns-desk')).toBe('dana/returns-desk');
    expect(repositoryOf('  hf://dana/returns-desk/ ')).toBe('dana/returns-desk');
    expect(repositoryOf('https://huggingface.co/dana/returns-desk')).toBe('dana/returns-desk');
    expect(repositoryOf('https://www.huggingface.co/dana/returns-desk/')).toBe('dana/returns-desk');
    expect(repositoryOf('')).toBe('');
  });

  it('names a publication by its commit, its page and the command that installs it', () => {
    expect(shortCommit(COMMIT)).toBe('3f1c9e2');
    expect(bareUrl('https://huggingface.co/jake/service-desk')).toBe(
      'huggingface.co/jake/service-desk',
    );
    expect(installCommand('jake/service-desk', COMMIT)).toBe(
      `architect install hf://jake/service-desk --revision ${COMMIT}`,
    );
  });

  it('says what a publication is doing, with the bytes the upload counted', () => {
    const progress = (patch: Partial<PublishProgress>): PublishProgress => ({
      graduateId: 'grd_desk',
      version: 2,
      repository: 'jake/service-desk',
      stage: 'uploading',
      sentBytes: 64 * 1024 ** 2,
      totalBytes: 118 * 1024 ** 2,
      ...patch,
    });
    expect(stageText(progress({ stage: 'connecting' }))).toBe(
      'Checking jake/service-desk on Hugging Face',
    );
    expect(stageText(progress({}))).toBe('Sending the package');
    expect(stageText(progress({ stage: 'verifying' }))).toBe('Checking the copy on Hugging Face');
    expect(stageText(progress({ stage: 'describing' }))).toBe('Adding the model card');
    expect(sentText(progress({}))).toBe('64 MB of 118 MB');
    expect(sentText(progress({ sentBytes: 0 }))).toBe('0 KB of 118 MB');
  });
});
