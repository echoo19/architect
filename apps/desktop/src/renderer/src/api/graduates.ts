import {
  ExportPartResultSchema,
  ExportResultSchema,
  ExportReviewSchema,
  GraduateSummarySchema,
  GraduateVersionSchema,
  HubInstallResultSchema,
  ImportPreviewSchema,
  ImportResultSchema,
  InstallationSchema,
  PublicationReviewSchema,
  PublicationSchema,
  PublishResultSchema,
  ReportCardSchema,
  SampleAgentSchema,
  type BindRequest,
  type ExportPartRequest,
  type ExportRequest,
  type HubInstallRequest,
  type ImportRequest,
  type PublishRequest,
} from '@architect/shared';
import { z } from 'zod';
import { api, architect } from './client';
import { queryKeys } from './hooks';
import { fetchQuery, useQuery } from './query';

/** Checks a reply against its contract, so a mismatch becomes an error people can read. */
async function read<T>(label: string, schema: z.ZodType<T>, request: Promise<unknown>): Promise<T> {
  const result = schema.safeParse(await request);
  if (result.success) return result.data;
  console.error(`[api] ${label} returned data that doesn't match the contract.`, result.error);
  throw new Error(`Architect received data it couldn't read from ${label}.`);
}

/** An agent's versions, its installation on this computer, and moving and copying it. */
export const graduatesApi = {
  versions: (graduateId: string) =>
    read(
      'graduates.versions',
      z.array(GraduateVersionSchema),
      architect().graduates.versions(graduateId),
    ),
  report: (graduateId: string) =>
    read('graduates.report', ReportCardSchema, architect().graduates.report(graduateId)),
  installation: (graduateId: string) =>
    read(
      'graduates.installation',
      InstallationSchema,
      architect().graduates.installation(graduateId),
    ),
  acceptVersion: (graduateId: string, version: number) =>
    read(
      'graduates.acceptVersion',
      GraduateVersionSchema,
      architect().graduates.acceptVersion(graduateId, version),
    ),
  promote: (graduateId: string, version: number) =>
    read(
      'graduates.promote',
      GraduateSummarySchema,
      architect().graduates.promote(graduateId, version),
    ),
  rollback: (graduateId: string, version: number) =>
    read(
      'graduates.rollback',
      GraduateSummarySchema,
      architect().graduates.rollback(graduateId, version),
    ),
  /** Runs the install checks again: with one short request to the model unless told not to. */
  verify: (graduateId: string, options?: { loadModel: boolean }) =>
    read('graduates.verify', InstallationSchema, architect().graduates.verify(graduateId, options)),
  bind: (graduateId: string, request: BindRequest) =>
    read('graduates.bind', InstallationSchema, architect().graduates.bind(graduateId, request)),
  reviewExport: (graduateId: string, include: string[]) =>
    read(
      'graduates.reviewExport',
      ExportReviewSchema,
      architect().graduates.reviewExport(graduateId, undefined, include),
    ),
  exportPackage: (graduateId: string, request: ExportRequest) =>
    read(
      'graduates.exportPackage',
      ExportResultSchema,
      architect().graduates.exportPackage(graduateId, request),
    ),
  exportPart: (graduateId: string, request: ExportPartRequest) =>
    read(
      'graduates.exportPart',
      ExportPartResultSchema,
      architect().graduates.exportPart(graduateId, request),
    ),
  previewImport: (path: string) =>
    read('graduates.previewImport', ImportPreviewSchema, architect().graduates.previewImport(path)),
  importPackage: (path: string, request: ImportRequest) =>
    read(
      'graduates.importPackage',
      ImportResultSchema,
      architect().graduates.importPackage(path, request),
    ),
  installFromHub: (source: string, request: HubInstallRequest) =>
    read(
      'graduates.installFromHub',
      HubInstallResultSchema,
      architect().graduates.installFromHub(source, request),
    ),
  hasSampleAgent: () =>
    read('graduates.hasSampleAgent', z.boolean(), architect().graduates.hasSampleAgent()),
  prepareSampleAgent: () =>
    read(
      'graduates.prepareSampleAgent',
      SampleAgentSchema,
      architect().graduates.prepareSampleAgent(),
    ),
  rejectVersion: (graduateId: string, version: number) =>
    read(
      'graduates.rejectVersion',
      GraduateVersionSchema,
      architect().graduates.rejectVersion(graduateId, version),
    ),
  reviewPublication: (graduateId: string, request: PublishRequest) =>
    read(
      'graduates.reviewPublication',
      PublicationReviewSchema,
      architect().graduates.reviewPublication(graduateId, request),
    ),
  publish: (graduateId: string, request: PublishRequest) =>
    read(
      'graduates.publish',
      PublishResultSchema,
      architect().graduates.publish(graduateId, request),
    ),
  publications: (graduateId: string) =>
    read(
      'graduates.publications',
      z.array(PublicationSchema),
      architect().graduates.publications(graduateId),
    ),
};

export const graduateKeys = {
  versions: (graduateId: string) => `versions:${graduateId}`,
  installation: (graduateId: string) => `installation:${graduateId}`,
  report: (graduateId: string, version: number | null) => `version-report:${graduateId}:${version}`,
  publications: (graduateId: string) => `publications:${graduateId}`,
  sampleAgent: 'sample-agent',
};

/** Every publication of the agent's versions, oldest first, as recorded on this computer. */
export const usePublications = (graduateId: string) =>
  useQuery(graduateKeys.publications(graduateId), () => graduatesApi.publications(graduateId));

/**
 * Whether this build ships a ready-made agent. An engine that can't say hides the offer, since
 * an offer that can't be taken up is worse than none.
 */
export function useHasSampleAgent(): boolean {
  const query = useQuery(graduateKeys.sampleAgent, graduatesApi.hasSampleAgent);
  return query.status === 'success' && query.data;
}

/** The report card the agent's active version carries, from its own folder. */
export const useVersionReport = (agent: { id: string; activeVersion: number | null }) =>
  useQuery(graduateKeys.report(agent.id, agent.activeVersion), () => graduatesApi.report(agent.id));

export const useVersions = (graduateId: string) =>
  useQuery(graduateKeys.versions(graduateId), () => graduatesApi.versions(graduateId));

export const useInstallation = (graduateId: string) =>
  useQuery(graduateKeys.installation(graduateId), () => graduatesApi.installation(graduateId));

/**
 * Reads an agent's list entry, versions and installation again after something changed which
 * version runs or how it is set up here. Resolves once all three are read.
 */
export async function refreshAgent(graduateId: string): Promise<void> {
  await Promise.all([
    fetchQuery(queryKeys.graduates, api.graduates),
    fetchQuery(graduateKeys.versions(graduateId), () => graduatesApi.versions(graduateId)),
    fetchQuery(graduateKeys.installation(graduateId), () => graduatesApi.installation(graduateId)),
  ]);
}
