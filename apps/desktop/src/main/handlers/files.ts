import { BrowserWindow, dialog, type OpenDialogOptions } from 'electron';
import { z } from 'zod';
import type { PickedPaths } from '../files/picked';
import type { IpcRouter } from '../ipc/router';

const PickOptionsSchema = z
  .object({
    title: z.string().min(1),
    filters: z
      .array(z.object({ name: z.string().min(1), extensions: z.array(z.string().min(1)) }))
      .optional(),
    multiple: z.boolean().optional(),
    directory: z.boolean().optional(),
  })
  .strict();

/** The system's open dialog. What the user chooses is remembered as allowed for the engine. */
export function registerFilesHandlers(router: IpcRouter, picked: PickedPaths): void {
  router.registerHandlers(
    'files',
    {
      pick: async (options) => {
        const dialogOptions: OpenDialogOptions = {
          title: options.title,
          filters: options.filters ?? [],
          properties: [
            options.directory ? 'openDirectory' : 'openFile',
            ...(options.multiple ? (['multiSelections'] as const) : []),
          ],
        };
        const owner = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
        const result = owner
          ? await dialog.showOpenDialog(owner, dialogOptions)
          : await dialog.showOpenDialog(dialogOptions);
        if (result.canceled) return [];
        picked.add(result.filePaths, options.directory ? 'folders' : 'files');
        return result.filePaths;
      },
    },
    { pick: z.tuple([PickOptionsSchema]) },
  );
}
