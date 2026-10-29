import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { DataFile, Job } from '@architect/shared';
import { describe, expect, it } from 'vitest';
import { FilePermissions } from '../../../src/renderer/src/flow/define/JobOverview';
import { changeableOf } from '../../../src/renderer/src/flow/define/permissions';
import { makeJob } from './factories';

const READ = (name: string): DataFile => ({ name, kind: 'table', access: 'read' });
const WRITE = (name: string): DataFile => ({ name, kind: 'table', access: 'write' });

/** A job whose agent reads `invoices.csv` and can change whatever else is given. */
function jobWith(files: DataFile[], output?: { description?: string }): Job {
  const base = makeJob();
  return { ...base, data: { files, ...(output === undefined ? {} : { output }) } };
}

function render(job: Job, onChange: (permissions: Job['permissions']) => void = () => undefined) {
  return renderToStaticMarkup(createElement(FilePermissions, { job, onChange }));
}

/** What a person reads: no tags, the entities decoded, one space between words. */
function text(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

describe('where the trained agent can change something', () => {
  it('is nowhere for a job whose files it only reads and that has no output folder', () => {
    expect(changeableOf(jobWith([READ('invoices.csv'), READ('policy.md')]))).toBeNull();
    expect(changeableOf(makeJob())).toBeNull();
  });

  it('is the files the job lets it write, and its output folder when it has one', () => {
    expect(changeableOf(jobWith([READ('policy.md'), WRITE('invoices.csv')]))).toEqual({
      files: ['invoices.csv'],
      folder: false,
    });
    expect(changeableOf(jobWith([READ('policy.md')], { description: 'Reports.' }))).toEqual({
      files: [],
      folder: true,
    });
    // An output folder with no description is still a folder it can make files in.
    expect(changeableOf(jobWith([READ('policy.md')], {}))).toEqual({ files: [], folder: true });
    expect(changeableOf(jobWith([WRITE('invoices.csv'), WRITE('bookings.csv')], {}))).toEqual({
      files: ['invoices.csv', 'bookings.csv'],
      folder: true,
    });
  });
});

describe('the permissions Define shows', () => {
  it('offers no choice about saving to an agent that can change no file, and says so', () => {
    const html = render(jobWith([READ('invoices.csv')]));
    // No control, in any form: a choice about something that cannot happen.
    expect(html).not.toContain('radiogroup');
    expect(html).not.toMatch(/Ask first|Allow|Never/);
    expect(html).not.toContain('Saving files');
    // And not the line that said there was no file while asking what to do about files.
    expect(text(html)).not.toContain('No file it can change');
    expect(text(html)).toBe('Permissions Files it can change None');
  });

  it('offers the choice where a file can change, with the files it covers', () => {
    const html = render(jobWith([READ('policy.md'), WRITE('invoices.csv'), WRITE('bookings.csv')]));
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain('aria-label="Saving files"');
    for (const mode of ['Ask first', 'Allow', 'Never']) expect(text(html)).toContain(mode);
    expect(html).toContain('<span class="font-mono">invoices.csv, bookings.csv</span>');
    expect(text(html)).not.toContain('output folder');
    expect(text(html)).not.toContain('Files it can change');
    // The answer the job holds is the one chosen.
    expect(html).toMatch(/aria-checked="true"[^>]*>Ask first</);
  });

  it('offers it for an output folder alone, and says that is what it covers', () => {
    // An agent that makes files in its output folder has files to ask first about, though none of
    // the job's own is writable, so "No file it can change" would be untrue.
    const html = render(
      jobWith([READ('policy.md')], { description: 'Notes for the technicians.' }),
    );
    expect(html).toContain('role="radiogroup"');
    expect(text(html)).toContain('Its output folder');
    expect(text(html)).not.toContain('No file it can change');
    expect(text(html)).not.toContain('None');
  });

  it('says both when the agent can change files and has an output folder', () => {
    const html = render(jobWith([WRITE('invoices.csv')], { description: 'Reports.' }));
    expect(text(html)).toContain('invoices.csv and its output folder');
  });
});
