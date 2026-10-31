import type { ContactRecorder, LoopDeps } from './deps';

/**
 * The loop's dependencies with every adapter they make telling `record` where its requests go
 * (decision 095), so a run's own records say which hosts it contacted and how often.
 */
export function recordingContacts(deps: LoopDeps, record: ContactRecorder): LoopDeps {
  const { adapters } = deps;
  const { createActor, createAdapterStudent, createTranscriber } = adapters;
  const contacted = record;
  return {
    ...deps,
    adapters: {
      ...adapters,
      createMentor: (config, options) => adapters.createMentor(config, { ...options, contacted }),
      createStudent: (endpoint, options) =>
        adapters.createStudent(endpoint, { ...options, contacted }),
      ...(createActor === undefined
        ? {}
        : { createActor: (config, options) => createActor(config, { ...options, contacted }) }),
      ...(createAdapterStudent === undefined
        ? {}
        : {
            createAdapterStudent: (request, options) =>
              createAdapterStudent(request, { ...options, contacted }),
          }),
      ...(createTranscriber === undefined
        ? {}
        : { createTranscriber: (options) => createTranscriber({ ...options, contacted }) }),
    },
  };
}
