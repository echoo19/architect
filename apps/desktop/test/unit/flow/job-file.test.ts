import { describe, expect, it } from 'vitest';
import { jobFileName } from '../../../src/renderer/src/flow/define/job-file';

describe("a job file's name", () => {
  it('follows the job name, in lower case with dashes', () => {
    expect(jobFileName('Service desk')).toBe('service-desk.job.json');
    expect(jobFileName('Returns desk, 2026')).toBe('returns-desk-2026.job.json');
  });

  it('drops accents and symbols a file name should not carry', () => {
    expect(jobFileName('Café orders / refunds')).toBe('cafe-orders-refunds.job.json');
    expect(jobFileName('  --Close out: Tuesday--  ')).toBe('close-out-tuesday.job.json');
  });

  it('is just job.json for a name with nothing in it a file name could use', () => {
    expect(jobFileName('???')).toBe('job.json');
    expect(jobFileName('')).toBe('job.json');
  });

  it('stays short for a very long name, without ending on a dash', () => {
    const name = jobFileName(`${'abcdefghi '.repeat(12)}end`);
    expect(name.endsWith('.job.json')).toBe(true);
    expect(name.length).toBeLessThanOrEqual(60 + '.job.json'.length);
    expect(name.replace('.job.json', '')).not.toMatch(/-$/);
  });
});
