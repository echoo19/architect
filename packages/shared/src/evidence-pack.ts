import { z } from 'zod';
import { PermissionModeSchema } from './job';
import { RunContactSchema } from './network';
import { BaseModelSchema, IntegrityEntrySchema, Sha256Schema } from './package';
import { ScoreSchema } from './lineage';
import { CertificateSchema } from './report';

/*
 * An evidence pack (decision 095): one folder about one version, for a security reviewer and an
 * offline install. The version's package as it is, `evidence.json` assembled from records that
 * already exist, a short README, and MANIFEST.json with the SHA-256 of every other file. Nothing
 * from the locked test's tasks or a never-seen organization's files: scores only (invariant 1).
 * Its JSON keys are snake_case on disk, like every other Architect file.
 */

export const EVIDENCE_FORMAT = 'architect.evidence/1';
export const EVIDENCE_MANIFEST_FORMAT = 'architect.evidence-manifest/1';
export const EVIDENCE_FILE = 'evidence.json';
export const EVIDENCE_MANIFEST_FILE = 'MANIFEST.json';
export const EVIDENCE_README_FILE = 'README.md';
/** The version's package, byte for byte: `architect install` takes it as it is. */
export const EVIDENCE_PACKAGE_DIR = 'package';
/** Where the base model's file goes when the person asks for it. */
export const EVIDENCE_WEIGHTS_DIR = 'weights';

export const EvidenceRequestSchema = z
  .object({
    /** The folder the pack's own folder is written into. */
    directory: z.string().min(1),
    /** The active version when absent. */
    version: z.number().int().positive().optional(),
    /** Copy the base model's file from this computer, when it is here, instead of naming its hash. */
    withWeights: z.boolean().optional(),
  })
  .strict();
export type EvidenceRequest = z.infer<typeof EvidenceRequestSchema>;

/** `referenced`: named by hash only. `copied`: the file is in `weights/`. `missing`: asked for, not here. */
export const WeightsStateSchema = z.enum(['referenced', 'copied', 'missing']);
export type WeightsState = z.infer<typeof WeightsStateSchema>;

export const EvidenceResultSchema = z.object({
  /** The pack's folder. */
  folder: z.string().min(1),
  version: z.number().int().positive(),
  /** Every file in it, MANIFEST.json last. */
  files: z.array(z.string()),
  bytes: z.number().int().nonnegative(),
  /** SHA-256 of MANIFEST.json, to read out to whoever checks it. */
  manifestSha256: Sha256Schema,
  weights: WeightsStateSchema,
});
export type EvidenceResult = z.infer<typeof EvidenceResultSchema>;

export const EvidenceManifestSchema = z
  .object({
    format: z.literal(EVIDENCE_MANIFEST_FORMAT),
    algorithm: z.literal('sha256'),
    /** Every file in the pack except MANIFEST.json itself, in path order. */
    files: z.array(IntegrityEntrySchema),
  })
  .strict();
export type EvidenceManifest = z.infer<typeof EvidenceManifestSchema>;

/** A version's result at one organization, summed over its task types. */
export const OrganizationEvidenceSchema = z
  .object({
    org: z.string(),
    name: z.string(),
    /** Taught on, or kept from teaching for the final test. */
    kind: z.enum(['seen', 'never_seen']),
    /** Its records are real, not generated. */
    real: z.boolean(),
    pass: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
  })
  .strict();
export type OrganizationEvidence = z.infer<typeof OrganizationEvidenceSchema>;

/** One destination the graduates' network guard was asked about while the pack was written. */
export const NetworkProbeSchema = z
  .object({ destination: z.string(), allowed: z.boolean() })
  .strict();
export type NetworkProbe = z.infer<typeof NetworkProbeSchema>;

export const EvidencePackSchema = z
  .object({
    format: z.literal(EVIDENCE_FORMAT),
    agent: z.object({ id: z.string(), name: z.string() }).strict(),
    version: z.number().int().positive(),
    createdAt: z.iso.datetime(),
    packedAt: z.iso.datetime(),
    package: z
      .object({
        path: z.literal(EVIDENCE_PACKAGE_DIR),
        /** SHA-256 of its `graduate.json`, which lists the hash of every other file in it. */
        digest: Sha256Schema,
        files: z.number().int().positive(),
      })
      .strict(),
    harness: z
      .object({
        hash: z.string(),
        format: z.number().int().positive(),
        version: z.number().int().nonnegative(),
        round: z.number().int().positive().optional(),
      })
      .strict(),
    model: z
      .object({
        label: z.string(),
        base: BaseModelSchema,
        adapter: z
          .object({
            sha256: Sha256Schema,
            sizeBytes: z.number().int().nonnegative(),
            baseDigest: z.string(),
            scale: z.number().positive(),
            standIn: z.literal(true).optional(),
          })
          .strict()
          .nullable(),
        weights: z
          .object({
            state: WeightsStateSchema,
            /** The copied file, in the pack. */
            path: z.string().optional(),
            sha256: Sha256Schema.optional(),
          })
          .strict(),
      })
      .strict(),
    tools: z
      .object({
        /** Where every tool runs, and the limits it runs under. */
        sandbox: z
          .object({
            engine: z.literal('QuickJS'),
            process: z.literal('child process'),
            timeoutMs: z.number().int().positive(),
            memoryBytes: z.number().int().positive(),
            network: z.literal('none'),
          })
          .strict(),
        /** What the version may do with files, as its contract says. */
        permissions: z
          .object({
            writes: PermissionModeSchema,
            unseenFiles: PermissionModeSchema,
            network: z.literal('none'),
            reads: z.array(z.string()),
            changes: z.array(z.string()),
            folders: z.array(z.object({ name: z.string(), access: z.string() }).strict()),
          })
          .strict(),
        /** Each tool's files in the package, by hash. */
        list: z.array(
          z.object({ name: z.string(), files: z.array(IntegrityEntrySchema) }).strict(),
        ),
      })
      .strict(),
    network: z
      .object({
        /** The locked test ran on this computer's model, offline; null when no locked test ran. */
        lockedTestRanOffline: z.boolean().nullable(),
        /** The rule the graduate runs under (invariant 3), and how it answered each probe. */
        graduate: z
          .object({
            rule: z.string(),
            probes: z.array(NetworkProbeSchema),
            passed: z.boolean(),
          })
          .strict(),
      })
      .strict(),
    teaching: z
      .object({
        /** The run that made the version, when it was made on this computer. */
        runId: z.string().nullable(),
        hosts: z.array(RunContactSchema),
        /** The hosts in one line, or why there are none to show. */
        line: z.string(),
      })
      .strict(),
    lineage: z
      .object({
        changes: z.number().int().nonnegative(),
        kept: z.number().int().nonnegative(),
        reverted: z.number().int().nonnegative(),
        entries: z.array(
          z
            .object({
              round: z.number().int().positive(),
              title: z.string(),
              decision: z.enum(['kept', 'reverted']),
              devBefore: ScoreSchema,
              devAfter: ScoreSchema,
            })
            .strict(),
        ),
      })
      .strict(),
    /** The final test at each organization; empty for a job without organizations. */
    organizations: z.array(OrganizationEvidenceSchema),
    /** The locked test as a whole; null when no locked test measured the version. */
    lockedTest: z
      .object({ score: ScoreSchema, passRate: z.number(), target: z.number(), met: z.boolean() })
      .strict()
      .nullable(),
    certificate: CertificateSchema.nullable(),
  })
  .strict();
export type EvidencePack = z.infer<typeof EvidencePackSchema>;

/** What `architect verify --pack` found: every problem in plain words, none when all matched. */
export const EvidenceCheckSchema = z.object({
  ok: z.boolean(),
  /** Files whose hash and size were checked against MANIFEST.json. */
  checked: z.number().int().nonnegative(),
  problems: z.array(z.string()),
  /** SHA-256 of MANIFEST.json as found, to compare with the one its author read out. */
  manifestSha256: Sha256Schema.optional(),
  agent: z.object({ name: z.string(), version: z.number().int().positive() }).optional(),
});
export type EvidenceCheck = z.infer<typeof EvidenceCheckSchema>;
