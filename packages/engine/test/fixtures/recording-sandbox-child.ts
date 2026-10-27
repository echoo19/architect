import { referencedHashes, RunRequestSchema } from '../../src/sandbox/protocol';

/**
 * A stand-in sandbox child that runs nothing. It answers each request with what it received:
 * how many data blobs came along and the names of its environment variables. A tool named
 * evicted pretends the child dropped its data when no blobs arrive with the request.
 */
process.on('message', (raw: unknown) => {
  const request = RunRequestSchema.parse(raw);
  const blobCount = Object.keys(request.blobs).length;
  const evicted = request.job.kind === 'tool' && request.job.name === 'evicted';
  if (evicted && blobCount === 0) {
    process.send?.({ type: 'missing', id: request.id, hashes: referencedHashes(request.job) });
    return;
  }
  const report = { blobCount, environment: Object.keys(process.env).sort() };
  process.send?.({
    type: 'result',
    id: request.id,
    outcome: { ok: true, json: JSON.stringify(report) },
  });
});
process.on('disconnect', () => process.exit(0));
process.send?.({ type: 'ready' });
