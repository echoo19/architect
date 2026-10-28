import {
  ExportPartResultSchema,
  ExportResultSchema,
  ExportReviewSchema,
  GraduateSummarySchema,
  GraduateVersionSchema,
  ImportPreviewSchema,
  ImportResultSchema,
  InstallationSchema,
  ReportCardSchema,
  type BindRequest,
  type ExportPartRequest,
  type ExportRequest,
  type ImportRequest,
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
  verify: (graduateId: string) =>
    read('graduates.verify', InstallationSchema, architect().graduates.verify(graduateId)),
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
};

export const graduateKeys = {
  versions: (graduateId: string) => `versions:${graduateId}`,
  installation: (graduateId: string) => `installation:${graduateId}`,
  report: (graduateId: string, version: number | null) => `version-report:${graduateId}:${version}`,
};

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
