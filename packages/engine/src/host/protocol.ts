import {
  AdapterError,
  DraftTurnSchema,
  FileDiffSchema,
  GraduateSettingsSchema,
  GraduateSummarySchema,
  GuardError,
  JobSchema,
  JobSummarySchema,
  ReportCardSchema,
  RunDetailSchema,
  RunEventSchema,
  RunSchema,
  RunStartOptionsSchema,
  TraceSchema,
  type AdapterErrorCode,
  type ArchitectApi,
} from '@architect/shared';
import { z } from 'zod';

/** The part of the app's API the engine host serves. */
export type EngineApi = Pick<ArchitectApi, 'jobs' | 'runs' | 'reports' | 'graduates'>;

const id = z.string().min(1);
const path = z.string().min(1);

/**
 * One request type: the schema its parameters must pass on the host, the schema its result
 * must pass on the client, and how the host answers it.
 */
function route<P extends z.ZodType<unknown[]>, R extends z.ZodType>(
  params: P,
  result: R,
  answer: (api: EngineApi, params: z.output<P>) => Promise<z.input<R>>,
) {
  return {
    params,
    result,
    answer: (api: EngineApi, raw: unknown) => answer(api, params.parse(raw)),
  };
}

export const ENGINE_ROUTES = {
  'jobs.list': route(z.tuple([]), z.array(JobSummarySchema), (api) => api.jobs.list()),
  'jobs.get': route(z.tuple([id]), JobSchema, (api, [jobId]) => api.jobs.get(jobId)),
  'jobs.save': route(z.tuple([JobSchema]), JobSchema, (api, [job]) => api.jobs.save(job)),
  'jobs.createSample': route(z.tuple([]), JobSchema, (api) => api.jobs.createSample()),
  'jobs.importFile': route(z.tuple([path]), JobSchema, (api, [file]) => api.jobs.importFile(file)),
  'jobs.exportFile': route(z.tuple([id, path]), z.void(), (api, [jobId, file]) =>
    api.jobs.exportFile(jobId, file),
  ),
  'jobs.draftStart': route(
    z.tuple([z.string().min(1), z.array(path)]),
    DraftTurnSchema,
    (api, [description, files]) => api.jobs.draftStart(description, files),
  ),
  'jobs.draftReply': route(
    z.tuple([id, z.string().min(1)]),
    DraftTurnSchema,
    (api, [sessionId, text]) => api.jobs.draftReply(sessionId, text),
  ),
  'runs.start': route(z.tuple([id, RunStartOptionsSchema]), RunSchema, (api, [jobId, options]) =>
    api.runs.start(jobId, options),
  ),
  'runs.pause': route(z.tuple([id]), z.void(), (api, [runId]) => api.runs.pause(runId)),
  'runs.resume': route(z.tuple([id]), z.void(), (api, [runId]) => api.runs.resume(runId)),
  'runs.stop': route(z.tuple([id]), z.void(), (api, [runId]) => api.runs.stop(runId)),
  'runs.get': route(z.tuple([id]), RunDetailSchema, (api, [runId]) => api.runs.get(runId)),
  'runs.list': route(z.tuple([id.nullable()]), z.array(RunSchema), (api, [jobId]) =>
    api.runs.list(jobId ?? undefined),
  ),
  'runs.trace': route(z.tuple([id]), TraceSchema, (api, [attemptId]) => api.runs.trace(attemptId)),
  'runs.roundDiff': route(
    z.tuple([id, z.number().int().positive()]),
    z.array(FileDiffSchema),
    (api, [runId, round]) => api.runs.roundDiff(runId, round),
  ),
  'reports.get': route(z.tuple([id]), ReportCardSchema, (api, [runId]) => api.reports.get(runId)),
  'graduates.list': route(z.tuple([]), z.array(GraduateSummarySchema), (api) =>
    api.graduates.list(),
  ),
  'graduates.accept': route(z.tuple([id]), GraduateSummarySchema, (api, [runId]) =>
    api.graduates.accept(runId),
  ),
  'graduates.exportFolder': route(z.tuple([id, path]), z.void(), (api, [graduateId, folder]) =>
    api.graduates.exportFolder(graduateId, folder),
  ),
  'graduates.importFolder': route(z.tuple([path]), GraduateSummarySchema, (api, [folder]) =>
    api.graduates.importFolder(folder),
  ),
  'graduates.remove': route(z.tuple([id]), z.void(), (api, [graduateId]) =>
    api.graduates.remove(graduateId),
  ),
  'graduates.settings': route(z.tuple([id]), GraduateSettingsSchema, (api, [graduateId]) =>
    api.graduates.settings(graduateId),
  ),
  'graduates.updateSettings': route(
    z.tuple([id, GraduateSettingsSchema.partial().strict()]),
    GraduateSettingsSchema,
    (api, [graduateId, patch]) => api.graduates.updateSettings(graduateId, patch),
  ),
};

export type EngineRoutes = typeof ENGINE_ROUTES;
export type EngineMethod = keyof EngineRoutes;
export type EngineParams<M extends EngineMethod> = z.input<EngineRoutes[M]['params']>;
export type EngineResult<M extends EngineMethod> = z.output<EngineRoutes[M]['result']>;

export function isEngineMethod(method: string): method is EngineMethod {
  return Object.hasOwn(ENGINE_ROUTES, method);
}

export const RequestMessageSchema = z.object({
  kind: z.literal('request'),
  id: z.number().int().nonnegative(),
  method: z.string(),
  params: z.array(z.unknown()),
});

const GuardNameSchema = z.enum(['budget', 'split', 'network', 'harness_surface', 'permission']);

export const ErrorPayloadSchema = z.object({
  name: z.string(),
  message: z.string(),
  guard: GuardNameSchema.optional(),
  code: z.string().optional(),
});
export type ErrorPayload = z.infer<typeof ErrorPayloadSchema>;

export const ResponseMessageSchema = z.discriminatedUnion('ok', [
  z.object({
    kind: z.literal('response'),
    id: z.number().int().nonnegative(),
    ok: z.literal(true),
    result: z.unknown(),
  }),
  z.object({
    kind: z.literal('response'),
    id: z.number().int().nonnegative(),
    ok: z.literal(false),
    error: ErrorPayloadSchema,
  }),
]);

export const EventMessageSchema = z.object({ kind: z.literal('event'), event: RunEventSchema });

const ADAPTER_ERROR_CODES: readonly AdapterErrorCode[] = [
  'auth',
  'not_found',
  'rate_limit',
  'quota',
  'network',
  'timeout',
  'server',
  'bad_request',
  'bad_response',
  'aborted',
  'blocked',
];

function isAdapterErrorCode(code: string): code is AdapterErrorCode {
  return (ADAPTER_ERROR_CODES as readonly string[]).includes(code);
}

/** Errors cross the port as plain data and come back typed, so guards keep their meaning. */
export function toErrorPayload(error: unknown): ErrorPayload {
  if (error instanceof GuardError)
    return { name: error.name, message: error.message, guard: error.guard };
  if (error instanceof AdapterError)
    return { name: error.name, message: error.message, code: error.code };
  if (error instanceof z.ZodError) {
    return {
      name: 'ValidationError',
      message: `The request was invalid: ${z.prettifyError(error)}`,
    };
  }
  if (error instanceof Error) return { name: error.name, message: error.message };
  return { name: 'Error', message: String(error) };
}

export function fromErrorPayload(payload: ErrorPayload): Error {
  if (payload.name === 'GuardError' && payload.guard)
    return new GuardError(payload.guard, payload.message);
  if (payload.name === 'AdapterError' && payload.code && isAdapterErrorCode(payload.code)) {
    return new AdapterError(payload.code, payload.message);
  }
  const error = new Error(payload.message);
  error.name = payload.name;
  return error;
}
