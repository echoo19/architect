import { useState } from 'react';
import { IconButton, Spinner, toast, Tooltip } from '@architect/ui';
import { FileDown } from 'lucide-react';
import { flowApi } from '../../api/client';
import { attempt } from '../../lib/notify';
import { fileName } from '../format';
import { jobFileName } from './job-file';
import type { JobEditor } from './use-job-editor';

/**
 * Saves the job's settings as a job file, wherever the person chooses: the file another computer
 * imports to start from this job. Its tasks and data files stay on this computer, and the button
 * says so.
 */
export function ExportJobFile({ editor }: { editor: JobEditor }) {
  const [exporting, setExporting] = useState(false);

  const exportJob = async () => {
    setExporting(true);
    // The file holds the job as it is saved, with any edit still waiting.
    const saved = await editor.flush();
    if (!saved) {
      // A save the engine refused has said so already; a field that isn't valid hasn't.
      if (Object.keys(editor.issues).length > 0) {
        toast({
          tone: 'danger',
          title: 'Fix the marked field first',
          description: 'The job file holds the job as it is saved.',
        });
      }
    } else {
      const file = await attempt("Couldn't open the save dialog", () =>
        flowApi.saveFile({
          title: 'Export the job file',
          defaultName: jobFileName(saved.name),
          filters: [{ name: 'Job file', extensions: ['json'] }],
        }),
      );
      if (file) {
        const written = await attempt("Couldn't export the job file", async () => {
          await flowApi.exportJob(saved.id, file);
          return true;
        });
        if (written) {
          toast({
            title: 'Job file saved',
            description: `${fileName(file)}. Its tasks and data files stay on this computer.`,
          });
        }
      }
    }
    setExporting(false);
  };

  return (
    <Tooltip content="Export the job file. Its tasks and data files stay on this computer.">
      <IconButton
        label="Export the job file"
        disabled={exporting}
        aria-busy={exporting || undefined}
        onClick={() => void exportJob()}
      >
        {exporting ? <Spinner size={16} /> : <FileDown size={18} strokeWidth={1.8} aria-hidden />}
      </IconButton>
    </Tooltip>
  );
}
