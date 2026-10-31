import { BrowserWindow, dialog, type OpenDialogOptions, type SaveDialogOptions } from 'electron';
import { z } from 'zod';
import type { PickedPaths } from '../files/picked';
import type { IpcRouter } from '../ipc/router';

const FiltersSchema = z
  .array(z.object({ name: z.string().min(1), extensions: z.array(z.string().min(1)) }))
  .optional();

const PickOptionsSchema = z
  .object({
    title: z.string().min(1),
    filters: FiltersSchema,
    multiple: z.boolean().optional(),
    directory: z.boolean().optional(),
    /** Where the dialog opens; nothing is allowed until the person chooses it. */
    defaultPath: z.string().min(1).optional(),
  })
  .strict();

const SaveOptionsSchema = z
  .object({ title: z.string().min(1), defaultName: z.string().min(1), filters: FiltersSchema })
  .strict();

/**
 * The system's open and save dialogs. What the user chooses is remembered as allowed for the
 * engine: a file or folder to read, or the one file to write.
 */
export function registerFilesHandlers(router: IpcRouter, picked: PickedPaths): void {
  router.registerHandlers(
    'files',
    {
      pick: async (options) => {
        const dialogOptions: OpenDialogOptions = {
          title: options.title,
          ...(options.defaultPath === undefined ? {} : { defaultPath: options.defaultPath }),
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
      save: async (options) => {
        const dialogOptions: SaveDialogOptions = {
          title: options.title,
          defaultPath: options.defaultName,
          filters: options.filters ?? [],
        };
        const owner = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
        const result = owner
          ? await dialog.showSaveDialog(owner, dialogOptions)
          : await dialog.showSaveDialog(dialogOptions);
        if (result.canceled || result.filePath === undefined) return null;
        picked.add([result.filePath], 'files');
        return result.filePath;
      },
    },
    { pick: z.tuple([PickOptionsSchema]), save: z.tuple([SaveOptionsSchema]) },
  );
}
