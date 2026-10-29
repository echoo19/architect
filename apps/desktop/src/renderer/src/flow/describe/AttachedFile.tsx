import { FileChip } from '@architect/ui';
import { ListChecks } from 'lucide-react';
import { fileName } from '../format';

/** Files read as example requests with their answers: task lists by name or format. */
function isTaskFile(path: string): boolean {
  return /\.jsonl$/i.test(path) || /(^|[\\/])tasks?\.csv$/i.test(path);
}

/** A file attached to the job, with example tasks marked apart from the data. */
export function AttachedFile({ path, onRemove }: { path: string; onRemove?: () => void }) {
  const tasks = isTaskFile(path);
  return (
    <FileChip
      name={fileName(path)}
      icon={tasks ? <ListChecks size={14} strokeWidth={1.6} aria-hidden /> : undefined}
      kind={tasks ? 'example tasks' : undefined}
      onRemove={onRemove}
    />
  );
}
