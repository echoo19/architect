import {
  AdapterError,
  AttemptPageSchema,
  AttemptQuerySchema,
  BindRequestSchema,
  browsedSplit,
  CapabilityBreakdownSchema,
  CategorySchema,
  CertificationSchema,
  QualificationSchema,
  QualifyRequestSchema,
  CertifyRequestSchema,
  CounterexampleSchema,
  ComparisonReportSchema,
  CorrectionRequestSchema,
  CorrectionSchema,
  ClarificationReplySchema,
  CodedError,
  DraftOrganizationSchema,
  DraftTurnSchema,
  ErrorCodeSchema,
  ExperimentDetailSchema,
  ExperimentEventSchema,
  ExperimentInputSchema,
  ExperimentRecordSchema,
  ExperimentSchema,
  ExperimentStartSchema,
  ImprovementSchema,
  ImprovementStartSchema,
  ImproveOptionsSchema,
  ExportPartRequestSchema,
  ExportPartResultSchema,
  ExportRequestSchema,
  ExportResultSchema,
  ExportReviewSchema,
  FieldExportManifestSchema,
  FieldViewSchema,
  AddOrganizationRequestSchema,
  FileDiffSchema,
  FolderFitSchema,
  GraduateSettingsSchema,
  GraduateSummarySchema,
  GraduateVersionSchema,
  GuardError,
  HarnessFileSchema,
  HubInstallRequestSchema,
  HubInstallResultSchema,
  ImportPreviewSchema,
  ImportRequestSchema,
  ImportResultSchema,
  InstallationSchema,
  InterventionSchema,
  JobSchema,
  JobSummarySchema,
  ListedAttemptSchema,
  ListedLessonSchema,
  MentorConfigSchema,
  MentoringProgressSchema,
  ModelConfigReadSchema,
  ModelConfigSourceSchema,
  PackageError,
  PackageInspectionSchema,
  PackageProblemCodeSchema,
  PublicationReviewSchema,
  PublicationSchema,
  PublishProgressSchema,
  PublishRequestSchema,
  PublishResultSchema,
  ReferenceOptionsSchema,
  ReferenceRecordSchema,
  ReportCardSchema,
  RecordingQuoteSchema,
  RuleConfirmationStateSchema,
  RunDetailSchema,
  RunEventSchema,
  RunSchema,
  RunStartOptionsSchema,
  RuntimeMeasurementSchema,
  SampleAgentSchema,
  SampleJobSchema,
  StudentTargetSchema,
  StudyStateSchema,
  TaskListingSchema,
  TaskPlanSchema,
  TeachingOverviewSchema,
  TraceSchema,
  TrainBundleRequestSchema,
  TranscribeRequestSchema,
  TrainingPlanRequestSchema,
  TrainingPlanSchema,
  VersionEventSchema,
  VersionPickSchema,
  WrittenTrainBundleSchema,
  type AdapterErrorCode,
  type ArchitectApi,
  type DraftOrganization,
  type DraftTurn,
  type Job,
  type MentorConfig,
} from '@architect/shared';
import { z } from 'zod';
import { HubError, type HubErrorCode } from '../hub';

/**
 * The part of the app's API the engine host serves. The conversation that drafts a job also takes
 * the teacher the person chose in Settings, which only the main process knows, so the renderer's
 * three calls gain a last argument on their way to the engine. An imported job file comes back as
 * the engine made it; the main process then keeps or replaces its models and says which.
 */
export type EngineApi = Pick<
  ArchitectApi,
  'runs' | 'mentoring' | 'teach' | 'experiments' | 'compute' | 'reports' | 'graduates'
> & {
  jobs: Omit<ArchitectApi['jobs'], 'draftStart' | 'draftReply' | 'draftField' | 'importFile'> & {
    importFile(path: string): Promise<Job>;
    draftStart(description: string, files: string[], teacher: MentorConfig): Promise<DraftTurn>;
    draftField(
      description: string,
      organizations: DraftOrganization[],
      teacher: MentorConfig,
    ): Promise<DraftTurn>;
    draftReply(sessionId: string, text: string, teacher: MentorConfig): Promise<DraftTurn>;
  };
};

const id = z.string().min(1);
const path = z.string().min(1);
const versionNumber = z.number().int().positive();

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
  'jobs.createSample': route(z.tuple([SampleJobSchema.optional()]), JobSchema, (api, [sample]) =>
    api.jobs.createSample(sample),
  ),
  'jobs.importFile': route(z.tuple([path]), JobSchema, (api, [file]) => api.jobs.importFile(file)),
  'jobs.exportFile': route(z.tuple([id, path]), z.void(), (api, [jobId, file]) =>
    api.jobs.exportFile(jobId, file),
  ),
  'jobs.draftStart': route(
    z.tuple([z.string().min(1), z.array(path), MentorConfigSchema]),
    DraftTurnSchema,
    (api, [description, files, teacher]) => api.jobs.draftStart(description, files, teacher),
  ),
  'jobs.draftField': route(
    z.tuple([z.string().min(1), z.array(DraftOrganizationSchema).min(1), MentorConfigSchema]),
    DraftTurnSchema,
    (api, [description, organizations, teacher]) =>
      api.jobs.draftField(description, organizations, teacher),
  ),
  'jobs.draftReply': route(
    z.tuple([id, z.string().min(1), MentorConfigSchema]),
    DraftTurnSchema,
    (api, [sessionId, text, teacher]) => api.jobs.draftReply(sessionId, text, teacher),
  ),
  'jobs.taskPlan': route(z.tuple([id]), TaskPlanSchema, (api, [jobId]) => api.jobs.taskPlan(jobId)),
  'jobs.confirmRules': route(
    z.tuple([id, id]),
    RuleConfirmationStateSchema,
    (api, [jobId, token]) => api.jobs.confirmRules(jobId, token),
  ),
  'jobs.study': route(z.tuple([id]), StudyStateSchema, (api, [jobId]) => api.jobs.study(jobId)),
  'jobs.confirmStudy': route(z.tuple([id, id]), StudyStateSchema, (api, [jobId, token]) =>
    api.jobs.confirmStudy(jobId, token),
  ),
  'jobs.quoteRecordings': route(
    z.tuple([id, id, z.array(z.string().min(1)).min(1).max(20)]),
    RecordingQuoteSchema,
    (api, [jobId, org, paths]) => api.jobs.quoteRecordings(jobId, org, paths),
  ),
  'jobs.shareRecordings': route(
    z.tuple([id, z.boolean()]),
    TaskPlanSchema,
    (api, [jobId, allowed]) => api.jobs.shareRecordings(jobId, allowed),
  ),
  'jobs.transcribe': route(
    z.tuple([id, TranscribeRequestSchema]),
    TaskPlanSchema,
    (api, [jobId, request]) => api.jobs.transcribe(jobId, request),
  ),
  'jobs.field': route(z.tuple([id]), FieldViewSchema, (api, [jobId]) => api.jobs.field(jobId)),
  'jobs.addOrganization': route(
    z.tuple([id, AddOrganizationRequestSchema]),
    FieldViewSchema,
    (api, [jobId, request]) => api.jobs.addOrganization(jobId, request),
  ),
  'jobs.teachOn': route(z.tuple([id, id]), FieldViewSchema, (api, [jobId, org]) =>
    api.jobs.teachOn(jobId, org),
  ),
  'jobs.fieldAssets': route(z.tuple([id]), FieldExportManifestSchema, (api, [jobId]) =>
    api.jobs.fieldAssets(jobId),
  ),
  'jobs.exportField': route(z.tuple([id, path]), FieldExportManifestSchema, (api, [jobId, dir]) =>
    api.jobs.exportField(jobId, dir),
  ),
  // The split stays a name here so the engine refuses one that can't be browsed by its code.
  'jobs.tasks': route(z.tuple([id, z.string().min(1)]), TaskListingSchema, (api, [jobId, split]) =>
    api.jobs.tasks(jobId, browsedSplit(split)),
  ),
  'runs.start': route(z.tuple([id, RunStartOptionsSchema]), RunSchema, (api, [jobId, options]) =>
    api.runs.start(jobId, options),
  ),
  'runs.pause': route(z.tuple([id]), z.void(), (api, [runId]) => api.runs.pause(runId)),
  'runs.resume': route(z.tuple([id]), z.void(), (api, [runId]) => api.runs.resume(runId)),
  'runs.stop': route(z.tuple([id]), z.void(), (api, [runId]) => api.runs.stop(runId)),
  'runs.qualifyAdded': route(z.tuple([id, z.string().min(1)]), z.void(), (api, [runId, org]) =>
    api.runs.qualifyAdded(runId, org),
  ),
  'runs.retest': route(z.tuple([id, StudentTargetSchema]), z.void(), (api, [runId, target]) =>
    api.runs.retest(runId, target),
  ),
  'runs.qualify': route(z.tuple([QualifyRequestSchema]), QualificationSchema, (api, [request]) =>
    api.runs.qualify(request),
  ),
  'runs.qualifications': route(z.tuple([id]), z.array(QualificationSchema), (api, [jobId]) =>
    api.runs.qualifications(jobId),
  ),
  'runs.get': route(z.tuple([id]), RunDetailSchema, (api, [runId]) => api.runs.get(runId)),
  'runs.list': route(z.tuple([id.nullable()]), z.array(RunSchema), (api, [jobId]) =>
    api.runs.list(jobId ?? undefined),
  ),
  'runs.attempt': route(z.tuple([id]), ListedAttemptSchema, (api, [attemptId]) =>
    api.runs.attempt(attemptId),
  ),
  'runs.trace': route(z.tuple([id]), TraceSchema, (api, [attemptId]) => api.runs.trace(attemptId)),
  'runs.roundDiff': route(
    z.tuple([id, z.number().int().positive()]),
    z.array(FileDiffSchema),
    (api, [runId, round]) => api.runs.roundDiff(runId, round),
  ),
  'runs.attempts': route(
    z.tuple([id, AttemptQuerySchema.nullable()]),
    AttemptPageSchema,
    (api, [runId, query]) => api.runs.attempts(runId, query ?? undefined),
  ),
  'runs.harnessFiles': route(
    z.tuple([id, versionNumber]),
    z.array(HarnessFileSchema),
    (api, [runId, version]) => api.runs.harnessFiles(runId, version),
  ),
  'runs.runtimeMeasurements': route(
    z.tuple([id]),
    z.array(RuntimeMeasurementSchema),
    (api, [runId]) => api.runs.runtimeMeasurements(runId),
  ),
  'mentoring.lessons': route(z.tuple([id]), z.array(ListedLessonSchema), (api, [runId]) =>
    api.mentoring.lessons(runId),
  ),
  'mentoring.lessonTrace': route(z.tuple([id]), TraceSchema.nullable(), (api, [lessonId]) =>
    api.mentoring.lessonTrace(lessonId),
  ),
  'mentoring.interventions': route(z.tuple([id]), z.array(InterventionSchema), (api, [runId]) =>
    api.mentoring.interventions(runId),
  ),
  'mentoring.experiments': route(z.tuple([id]), z.array(ExperimentSchema), (api, [runId]) =>
    api.mentoring.experiments(runId),
  ),
  'mentoring.progress': route(z.tuple([id]), MentoringProgressSchema, (api, [runId]) =>
    api.mentoring.progress(runId),
  ),
  'mentoring.capabilities': route(z.tuple([id]), CapabilityBreakdownSchema, (api, [runId]) =>
    api.mentoring.capabilities(runId),
  ),
  'mentoring.categories': route(z.tuple([id]), z.array(CategorySchema), (api, [jobId]) =>
    api.mentoring.categories(jobId),
  ),
  'mentoring.counterexamples': route(z.tuple([id]), z.array(CounterexampleSchema), (api, [runId]) =>
    api.mentoring.counterexamples(runId),
  ),
  'mentoring.fieldCounterexamples': route(
    z.tuple([id]),
    z.array(CounterexampleSchema),
    (api, [jobId]) => api.mentoring.fieldCounterexamples(jobId),
  ),
  'mentoring.answer': route(
    z.tuple([id, z.number().int().positive(), ClarificationReplySchema]),
    z.void(),
    (api, [runId, round, reply]) => api.mentoring.answer(runId, round, reply),
  ),
  'mentoring.reference': route(
    z.tuple([id, ReferenceOptionsSchema]),
    z.void(),
    (api, [runId, options]) => api.mentoring.reference(runId, options),
  ),
  'mentoring.references': route(z.tuple([id]), z.array(ReferenceRecordSchema), (api, [runId]) =>
    api.mentoring.references(runId),
  ),
  'teach.propose': route(
    z.tuple([id, id, CorrectionRequestSchema]),
    CorrectionSchema,
    (api, [chatId, messageId, request]) => api.teach.propose(chatId, messageId, request),
  ),
  'teach.queue': route(z.tuple([id]), CorrectionSchema, (api, [correctionId]) =>
    api.teach.queue(correctionId),
  ),
  'teach.discard': route(z.tuple([id]), CorrectionSchema, (api, [correctionId]) =>
    api.teach.discard(correctionId),
  ),
  'teach.list': route(z.tuple([id]), z.array(CorrectionSchema), (api, [graduateId]) =>
    api.teach.list(graduateId),
  ),
  'teach.improve': route(
    z.tuple([id, ImproveOptionsSchema]),
    ImprovementStartSchema,
    (api, [graduateId, options]) => api.teach.improve(graduateId, options),
  ),
  'teach.improvements': route(z.tuple([id]), z.array(ImprovementSchema), (api, [graduateId]) =>
    api.teach.improvements(graduateId),
  ),
  'teach.overview': route(z.tuple([id]), TeachingOverviewSchema, (api, [graduateId]) =>
    api.teach.overview(graduateId),
  ),
  'teach.shareCorrections': route(
    z.tuple([id, z.boolean()]),
    TeachingOverviewSchema,
    (api, [graduateId, allowed]) => api.teach.shareCorrections(graduateId, allowed),
  ),
  'experiments.plan': route(
    z.tuple([ExperimentInputSchema]),
    ExperimentDetailSchema,
    (api, [input]) => api.experiments.plan(input),
  ),
  'experiments.revise': route(
    z.tuple([id, ExperimentInputSchema]),
    ExperimentDetailSchema,
    (api, [experimentId, input]) => api.experiments.revise(experimentId, input),
  ),
  'experiments.calibrate': route(z.tuple([id]), ExperimentRecordSchema, (api, [experimentId]) =>
    api.experiments.calibrate(experimentId),
  ),
  'experiments.preregister': route(z.tuple([id]), ExperimentRecordSchema, (api, [experimentId]) =>
    api.experiments.preregister(experimentId),
  ),
  'experiments.start': route(
    z.tuple([id, ExperimentStartSchema]),
    ExperimentRecordSchema,
    (api, [experimentId, options]) => api.experiments.start(experimentId, options),
  ),
  'experiments.pause': route(z.tuple([id]), ExperimentRecordSchema, (api, [experimentId]) =>
    api.experiments.pause(experimentId),
  ),
  'experiments.resume': route(
    z.tuple([id, ExperimentStartSchema]),
    ExperimentRecordSchema,
    (api, [experimentId, options]) => api.experiments.resume(experimentId, options),
  ),
  'experiments.stop': route(z.tuple([id]), ExperimentRecordSchema, (api, [experimentId]) =>
    api.experiments.stop(experimentId),
  ),
  'experiments.list': route(z.tuple([]), z.array(ExperimentRecordSchema), (api) =>
    api.experiments.list(),
  ),
  'experiments.get': route(z.tuple([id]), ExperimentDetailSchema, (api, [experimentId]) =>
    api.experiments.get(experimentId),
  ),
  'compute.readConfig': route(
    z.tuple([ModelConfigSourceSchema]),
    ModelConfigReadSchema,
    (api, [source]) => api.compute.readConfig(source),
  ),
  'compute.plan': route(
    z.tuple([TrainingPlanRequestSchema]),
    TrainingPlanSchema,
    (api, [request]) => api.compute.plan(request),
  ),
  'compute.bundle': route(
    z.tuple([TrainBundleRequestSchema]),
    WrittenTrainBundleSchema,
    (api, [request]) => api.compute.bundle(request),
  ),
  'reports.get': route(
    z.tuple([id, StudentTargetSchema.nullable()]),
    ReportCardSchema,
    (api, [runId, target]) => api.reports.get(runId, target ?? undefined),
  ),
  'reports.list': route(z.tuple([id]), z.array(StudentTargetSchema), (api, [runId]) =>
    api.reports.list(runId),
  ),
  'reports.comparisons': route(z.tuple([id]), ComparisonReportSchema.nullable(), (api, [runId]) =>
    api.reports.comparisons(runId),
  ),
  'graduates.list': route(z.tuple([]), z.array(GraduateSummarySchema), (api) =>
    api.graduates.list(),
  ),
  'graduates.accept': route(z.tuple([id]), GraduateSummarySchema, (api, [runId]) =>
    api.graduates.accept(runId),
  ),
  'graduates.versions': route(z.tuple([id]), z.array(GraduateVersionSchema), (api, [graduateId]) =>
    api.graduates.versions(graduateId),
  ),
  'graduates.history': route(z.tuple([id]), z.array(VersionEventSchema), (api, [graduateId]) =>
    api.graduates.history(graduateId),
  ),
  'graduates.report': route(
    z.tuple([id, versionNumber.nullable()]),
    ReportCardSchema,
    (api, [graduateId, version]) => api.graduates.report(graduateId, version ?? undefined),
  ),
  'graduates.harnessDiff': route(
    z.tuple([VersionPickSchema, VersionPickSchema]),
    z.array(FileDiffSchema),
    (api, [from, to]) => api.graduates.harnessDiff(from, to),
  ),
  'graduates.harnessFiles': route(
    z.tuple([id, versionNumber]),
    z.array(HarnessFileSchema),
    (api, [graduateId, version]) => api.graduates.harnessFiles(graduateId, version),
  ),
  'graduates.planCertification': route(
    z.tuple([CertifyRequestSchema]),
    CertificationSchema,
    (api, [request]) => api.graduates.planCertification(request),
  ),
  'graduates.startCertification': route(z.tuple([id]), CertificationSchema, (api, [certId]) =>
    api.graduates.startCertification(certId),
  ),
  'graduates.discardCertification': route(z.tuple([id]), z.void(), (api, [certId]) =>
    api.graduates.discardCertification(certId),
  ),
  'graduates.certifications': route(
    z.tuple([id, versionNumber]),
    z.array(CertificationSchema),
    (api, [graduateId, version]) => api.graduates.certifications(graduateId, version),
  ),
  'graduates.acceptVersion': route(
    z.tuple([id, versionNumber]),
    GraduateVersionSchema,
    (api, [graduateId, version]) => api.graduates.acceptVersion(graduateId, version),
  ),
  'graduates.rejectVersion': route(
    z.tuple([id, versionNumber]),
    GraduateVersionSchema,
    (api, [graduateId, version]) => api.graduates.rejectVersion(graduateId, version),
  ),
  'graduates.promote': route(
    z.tuple([id, versionNumber]),
    GraduateSummarySchema,
    (api, [graduateId, version]) => api.graduates.promote(graduateId, version),
  ),
  'graduates.rollback': route(
    z.tuple([id, versionNumber]),
    GraduateSummarySchema,
    (api, [graduateId, version]) => api.graduates.rollback(graduateId, version),
  ),
  'graduates.installation': route(z.tuple([id]), InstallationSchema, (api, [graduateId]) =>
    api.graduates.installation(graduateId),
  ),
  'graduates.bind': route(
    z.tuple([id, BindRequestSchema]),
    InstallationSchema,
    (api, [graduateId, request]) => api.graduates.bind(graduateId, request),
  ),
  'graduates.checkFolder': route(
    z.tuple([id, z.string().min(1), path]),
    FolderFitSchema,
    (api, [graduateId, resource, folder]) =>
      api.graduates.checkFolder(graduateId, resource, folder),
  ),
  'graduates.verify': route(
    z.tuple([id, z.object({ loadModel: z.boolean().optional() }).strict()]),
    InstallationSchema,
    (api, [graduateId, options]) => api.graduates.verify(graduateId, options),
  ),
  'graduates.reviewExport': route(
    z.tuple([id, versionNumber.nullable(), z.array(z.string().min(1))]),
    ExportReviewSchema,
    (api, [graduateId, version, include]) =>
      api.graduates.reviewExport(graduateId, version ?? undefined, include),
  ),
  'graduates.exportPackage': route(
    z.tuple([id, ExportRequestSchema]),
    ExportResultSchema,
    (api, [graduateId, request]) => api.graduates.exportPackage(graduateId, request),
  ),
  'graduates.exportFolder': route(
    z.tuple([id, path]),
    ExportResultSchema,
    (api, [graduateId, directory]) => api.graduates.exportFolder(graduateId, directory),
  ),
  'graduates.exportPart': route(
    z.tuple([id, ExportPartRequestSchema]),
    ExportPartResultSchema,
    (api, [graduateId, request]) => api.graduates.exportPart(graduateId, request),
  ),
  'graduates.inspectPackage': route(z.tuple([path]), PackageInspectionSchema, (api, [file]) =>
    api.graduates.inspectPackage(file),
  ),
  'graduates.previewImport': route(z.tuple([path]), ImportPreviewSchema, (api, [file]) =>
    api.graduates.previewImport(file),
  ),
  'graduates.importPackage': route(
    z.tuple([path, ImportRequestSchema]),
    ImportResultSchema,
    (api, [file, request]) => api.graduates.importPackage(file, request),
  ),
  'graduates.importFolder': route(z.tuple([path]), GraduateSummarySchema, (api, [folder]) =>
    api.graduates.importFolder(folder),
  ),
  'graduates.installFromHub': route(
    z.tuple([z.string().min(1).max(300), HubInstallRequestSchema]),
    HubInstallResultSchema,
    (api, [source, request]) => api.graduates.installFromHub(source, request),
  ),
  'graduates.hasSampleAgent': route(z.tuple([]), z.boolean(), (api) =>
    api.graduates.hasSampleAgent(),
  ),
  'graduates.prepareSampleAgent': route(z.tuple([]), SampleAgentSchema, (api) =>
    api.graduates.prepareSampleAgent(),
  ),
  'graduates.reviewPublication': route(
    z.tuple([id, PublishRequestSchema]),
    PublicationReviewSchema,
    (api, [graduateId, request]) => api.graduates.reviewPublication(graduateId, request),
  ),
  'graduates.publish': route(
    z.tuple([id, PublishRequestSchema]),
    PublishResultSchema,
    (api, [graduateId, request]) => api.graduates.publish(graduateId, request),
  ),
  'graduates.publications': route(z.tuple([id]), z.array(PublicationSchema), (api, [graduateId]) =>
    api.graduates.publications(graduateId),
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
  /** A refused package's problems, one sentence each. */
  problems: z.array(z.string()).optional(),
  /** What to do about a Hugging Face failure. */
  hint: z.string().optional(),
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

/** An experiment moved: sent beside run events, so a screen reads it again. */
export const ExperimentEventMessageSchema = z.object({
  kind: z.literal('experiment.event'),
  event: ExperimentEventSchema,
});

/** A publication on its way to Hugging Face: sent beside run events while `publish` waits. */
export const PublishProgressMessageSchema = z.object({
  kind: z.literal('publish.progress'),
  progress: PublishProgressSchema,
});

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

const HUB_ERROR_CODES: readonly HubErrorCode[] = [
  'auth',
  'forbidden',
  'billing',
  'not_found',
  'conflict',
  'too_large',
  'rate_limit',
  'server',
  'network',
  'bad_response',
  'mismatch',
];

function isHubErrorCode(code: string): code is HubErrorCode {
  return (HUB_ERROR_CODES as readonly string[]).includes(code);
}

function isAdapterErrorCode(code: string): code is AdapterErrorCode {
  return (ADAPTER_ERROR_CODES as readonly string[]).includes(code);
}

/** Errors cross the port as plain data and come back typed, so guards keep their meaning. */
export function toErrorPayload(error: unknown): ErrorPayload {
  if (error instanceof GuardError)
    return { name: error.name, message: error.message, guard: error.guard };
  if (error instanceof AdapterError)
    return { name: error.name, message: error.message, code: error.code };
  if (error instanceof CodedError) {
    return { name: error.name, message: error.message, code: error.code };
  }
  if (error instanceof HubError) {
    return { name: error.name, message: error.message, code: error.code, hint: error.hint };
  }
  if (error instanceof PackageError) {
    return {
      name: error.name,
      message: error.message,
      code: error.code,
      problems: [...error.problems],
    };
  }
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
  if (payload.name === 'HubError' && payload.code && isHubErrorCode(payload.code)) {
    return new HubError(payload.code, payload.message, payload.hint ?? '');
  }
  const coded = ErrorCodeSchema.safeParse(payload.code);
  if (payload.name === 'CodedError' && coded.success) {
    return new CodedError(coded.data, payload.message);
  }
  const packageCode = PackageProblemCodeSchema.safeParse(payload.code);
  if (payload.name === 'PackageError' && packageCode.success) {
    return new PackageError(packageCode.data, payload.problems ?? [payload.message]);
  }
  const error = new Error(payload.message);
  error.name = payload.name;
  return error;
}
