import { MentorConfigSchema, StudentEndpointSchema } from '@architect/shared';
import { z } from 'zod';
import { testMentor, testStudent, type KeyLookup } from '../connections';
import type { IpcRouter } from '../ipc/router';

export function registerConnectionHandlers(router: IpcRouter, keys: KeyLookup): void {
  router.registerHandlers(
    'connections',
    {
      testMentor: (config) => testMentor(config, keys),
      testStudent: (endpoint) => testStudent(endpoint, keys),
    },
    {
      testMentor: z.tuple([MentorConfigSchema]),
      testStudent: z.tuple([StudentEndpointSchema]),
    },
  );
}
