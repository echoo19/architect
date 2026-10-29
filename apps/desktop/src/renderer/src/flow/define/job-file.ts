/**
 * A name for a job's file that a file dialog can offer: "Service desk" is `service-desk.job.json`,
 * and a name with nothing in it a file name could use is just `job.json`.
 */
export function jobFileName(jobName: string): string {
  const slug = jobName
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return slug === '' ? 'job.json' : `${slug}.job.json`;
}
