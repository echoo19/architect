import { z } from 'zod';
import { PermissionModeSchema } from './job';
import {
  EvaluationStatusSchema,
  INSTALL_CHECKS_LABEL,
  PackageManifestSchema,
  ResourceNameSchema,
  VersionRefSchema,
} from './package';

/**
 * A version's standing with the user. A candidate waits apart from the active version; accepting
 * it makes it eligible to run; promoting it, a separate step, makes it the active one.
 */
export const VersionStateSchema = z.enum(['candidate', 'accepted', 'rejected']);
export type VersionState = z.infer<typeof VersionStateSchema>;

/** One immutable version of an agent on this computer. */
export const GraduateVersionSchema = z.object({
  graduateId: z.string(),
  version: z.number().int().positive(),
  /** The local version it was derived from, when that version is on this computer. */
  parent: z.number().int().positive().optional(),
  /** For an imported version: the publisher's agent, version and digest it was copied from. */
  origin: VersionRefSchema.optional(),
  state: VersionStateSchema,
  active: z.boolean(),
  evaluation: EvaluationStatusSchema,
  contractVersion: z.number().int().positive(),
  /** sha256 of its `graduate.json`: the version's identity. */
  digest: z.string(),
  /** The run that made it, on this computer. */
  runId: z.string().optional(),
  /** The version's folder. */
  path: z.string(),
  manifest: PackageManifestSchema,
  createdAt: z.iso.datetime(),
  acceptedAt: z.iso.datetime().optional(),
});
export type GraduateVersion = z.infer<typeof GraduateVersionSchema>;

/** A promotion, rollback, acceptance or rejection, in the order they happened. */
export const VersionEventSchema = z.object({
  graduateId: z.string(),
  kind: z.enum(['created', 'accepted', 'rejected', 'promoted', 'rolled_back']),
  version: z.number().int().positive(),
  /** The version that was active before a promotion or rollback. */
  from: z.number().int().positive().optional(),
  at: z.iso.datetime(),
});
export type VersionEvent = z.infer<typeof VersionEventSchema>;

/** What an installation lets the graduate do with one of its folders. */
export const ResourceGrantSchema = z.enum(['none', 'read', 'read_write']);
export type ResourceGrant = z.infer<typeof ResourceGrantSchema>;

/** Permissions as this computer's user granted them. A package's requests are not grants. */
export const GrantsSchema = z
  .object({
    /** Writes: ask every time, allow without asking, or never. */
    writes: PermissionModeSchema,
    resources: z.record(ResourceNameSchema, ResourceGrantSchema),
  })
  .strict();
export type Grants = z.infer<typeof GrantsSchema>;

/**
 * Runtimes an installation can serve a graduate's model with in this build. A package that runs
 * on none of them is refused at import.
 */
export const BINDABLE_RUNTIMES = ['ollama', 'openai_compatible'] as const;

/** Where this computer serves the graduate's base model. Always a local runtime. */
export const ModelBindingSchema = z
  .object({
    runtime: z.enum(BINDABLE_RUNTIMES),
    baseUrl: z.url(),
    /** The name this runtime serves the base weights under. */
    model: z.string().min(1),
  })
  .strict();
export type ModelBinding = z.infer<typeof ModelBindingSchema>;

export const InstallStatusSchema = z.enum(['ready', 'needs_attention', 'blocked', 'unchecked']);
export type InstallStatus = z.infer<typeof InstallStatusSchema>;

export const InstallCheckSchema = z.object({
  id: z.string(),
  kind: z.string(),
  status: z.enum(['passed', 'failed', 'skipped']),
  detail: z.string(),
  ms: z.number().int().nonnegative().optional(),
});
export type InstallCheck = z.infer<typeof InstallCheckSchema>;

/** This computer, as the compatibility check saw it. */
export const MachineSchema = z.object({
  os: z.string(),
  arch: z.string(),
  memoryBytes: z.number().int().positive(),
});
export type Machine = z.infer<typeof MachineSchema>;

/**
 * A graduate on this computer: the folders its logical resources are bound to, what the user
 * granted, where its model runs, and the last installation checks of its active version. None of
 * it travels with an export.
 */
export const InstallationSchema = z.object({
  graduateId: z.string(),
  /** The version the checks below are for. */
  version: z.number().int().positive(),
  label: z.literal(INSTALL_CHECKS_LABEL),
  model: ModelBindingSchema,
  /** Logical resource name to a folder on this computer. */
  bindings: z.record(z.string(), z.string()),
  grants: GrantsSchema,
  status: InstallStatusSchema,
  /** Why it isn't ready, in words a person can act on. */
  reasons: z.array(z.string()),
  checks: z.array(InstallCheckSchema),
  machine: MachineSchema.optional(),
  measurements: z
    .object({
      /** From the model check's request to its first reply. */
      firstReplyMs: z.number().int().nonnegative().optional(),
    })
    .default({}),
  checkedAt: z.iso.datetime().optional(),
});
export type Installation = z.infer<typeof InstallationSchema>;

/** A Hugging Face (or other) publication of a version. Recorded only; publishing comes later. */
export const PublicationSchema = z.object({
  id: z.string(),
  graduateId: z.string(),
  version: z.number().int().positive(),
  destination: z.literal('huggingface'),
  repository: z.string().min(1),
  visibility: z.enum(['private', 'public']),
  /** The immutable commit, once the upload completed. */
  revision: z.string().optional(),
  url: z.string().optional(),
  status: z.enum(['staged', 'uploading', 'complete', 'failed']),
  error: z.string().optional(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Publication = z.infer<typeof PublicationSchema>;

/** One thing an export could carry, and whether it will. */
export const ExportItemSchema = z.object({
  /** `package`, `resource:<name>`, `chats`, `bindings`, `credentials` or `training_traces`. */
  id: z.string(),
  label: z.string(),
  included: z.boolean(),
  /** The user may change `included` with `include` on the export request. */
  optional: z.boolean(),
  reason: z.string(),
  /** Package paths or file names it covers. */
  files: z.array(z.string()),
  bytes: z.number().int().nonnegative(),
});
export type ExportItem = z.infer<typeof ExportItemSchema>;

/** Something the best-effort scan found in a file that would be exported. Never the value. */
export const ExportFindingSchema = z.object({
  path: z.string(),
  line: z.number().int().positive(),
  kind: z.enum(['stored_key', 'key_shape', 'private_path']),
  /** The line with the finding masked. */
  excerpt: z.string(),
});
export type ExportFinding = z.infer<typeof ExportFindingSchema>;

/** A part of a version that can leave on its own: its harness, its adapter, or its report. */
export const ExportPartNameSchema = z.enum(['harness', 'adapter', 'report']);
export type ExportPartName = z.infer<typeof ExportPartNameSchema>;

export const ExportPartSchema = z.object({
  part: ExportPartNameSchema,
  /** Package paths it covers. */
  files: z.array(z.string()),
  bytes: z.number().int().nonnegative(),
  /**
   * Names the review's findings in these files. An export of the part goes ahead despite them
   * only when it names the same.
   */
  findingsDigest: z.string(),
});
export type ExportPart = z.infer<typeof ExportPartSchema>;

export const ExportReviewSchema = z.object({
  graduateId: z.string(),
  version: z.number().int().positive(),
  name: z.string(),
  items: z.array(ExportItemSchema),
  /** What the scan found in exactly what this export would write. */
  findings: z.array(ExportFindingSchema),
  /** Names these findings: an export goes ahead despite them only when it names the same. */
  findingsDigest: z.string(),
  /** Shown before anything leaves: excluding files doesn't make trained weights anonymous. */
  notice: z.string(),
  /** The parts this version has that can be exported alone, each with its own findings. */
  parts: z.array(ExportPartSchema),
});
export type ExportReview = z.infer<typeof ExportReviewSchema>;

export const ExportPartRequestSchema = z
  .object({
    part: ExportPartNameSchema,
    /** The folder to write the part into. */
    directory: z.string().min(1),
    /** The active version unless named. */
    version: z.number().int().positive().optional(),
    /** The part's `findingsDigest` from the review the user saw, when the scan found anything. */
    acknowledgedFindings: z.string().optional(),
  })
  .strict();
export type ExportPartRequest = z.input<typeof ExportPartRequestSchema>;

export const ExportPartResultSchema = z.object({
  /** The folder (a harness) or file (an adapter, a report) written. */
  path: z.string(),
  /** What it holds, relative to `path` for a folder. */
  files: z.array(z.string()),
  bytes: z.number().int().nonnegative(),
  findings: z.array(ExportFindingSchema),
});
export type ExportPartResult = z.infer<typeof ExportPartResultSchema>;

export const ExportRequestSchema = z
  .object({
    /** The folder to write `<name>/` and `<name>.architect.zip` into. */
    directory: z.string().min(1),
    /** The active version unless named. */
    version: z.number().int().positive().optional(),
    /** Optional items to include, by id, e.g. `resource:data`. */
    include: z.array(z.string()).default([]),
    /**
     * The `findingsDigest` of the review the user saw. When the scan finds something, the export
     * goes ahead only if it finds exactly that.
     */
    acknowledgedFindings: z.string().optional(),
  })
  .strict();
export type ExportRequest = z.input<typeof ExportRequestSchema>;

export const ExportResultSchema = z.object({
  folder: z.string(),
  archive: z.string(),
  /** Package paths, in order. */
  files: z.array(z.string()),
  bytes: z.number().int().nonnegative(),
  /** sha256 of the exported `graduate.json`. */
  digest: z.string(),
  findings: z.array(ExportFindingSchema),
});
export type ExportResult = z.infer<typeof ExportResultSchema>;

/** Why a package was refused, before any of its code was loaded. */
export const PackageProblemCodeSchema = z.enum([
  'not_a_package',
  'unsafe_path',
  'link',
  'too_large',
  'too_many_files',
  'archive',
  'unknown_schema',
  'invalid_manifest',
  'checksum',
  'missing_file',
  'unlisted_file',
  'incompatible',
  'invalid_harness',
]);
export type PackageProblemCode = z.infer<typeof PackageProblemCodeSchema>;

export const PackageInspectionSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    manifest: PackageManifestSchema,
    digest: z.string(),
    /** 1 when the package is a format 1 graduate folder, read and converted. */
    migratedFrom: z.literal(1).optional(),
    files: z.number().int().nonnegative(),
    bytes: z.number().int().nonnegative(),
  }),
  z.object({
    ok: z.literal(false),
    code: PackageProblemCodeSchema,
    problems: z.array(z.string()).min(1),
  }),
]);
export type PackageInspection = z.infer<typeof PackageInspectionSchema>;

/** Where an import would go on this computer. */
export const ImportPlaceSchema = z.discriminatedUnion('kind', [
  /** A new agent, set up with the folders and grants the import names. */
  z.object({ kind: z.literal('new') }),
  /**
   * The next version of an agent this computer has, waiting as a candidate. The agent keeps its
   * own folders and grants.
   */
  z.object({
    kind: z.literal('version'),
    graduateId: z.string(),
    name: z.string(),
    version: z.number().int().positive(),
    parent: z.number().int().positive(),
  }),
  /** The same package is already installed here. */
  z.object({
    kind: z.literal('installed'),
    graduateId: z.string(),
    name: z.string(),
    version: z.number().int().positive(),
  }),
]);
export type ImportPlace = z.infer<typeof ImportPlaceSchema>;

/**
 * What installing a package would do, found without installing anything or loading its code:
 * the package checked as an import checks it, where it would go, and whether this computer can
 * run it and serves its base model. Its install checks come only after it is installed.
 */
export const ImportPreviewSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    manifest: PackageManifestSchema,
    digest: z.string(),
    /** 1 when the package is a format 1 graduate folder, read and converted. */
    migratedFrom: z.literal(1).optional(),
    files: z.number().int().nonnegative(),
    bytes: z.number().int().nonnegative(),
    place: ImportPlaceSchema,
    machine: MachineSchema,
    /** Where this computer would serve its model. */
    model: ModelBindingSchema,
    /** This computer's fit and its base model, checked here and labelled as this computer's. */
    checks: z.array(InstallCheckSchema),
    status: InstallStatusSchema,
    /** Why it can't run, or what needs doing first, in words a person can act on. */
    reasons: z.array(z.string()),
  }),
  z.object({
    ok: z.literal(false),
    code: PackageProblemCodeSchema,
    problems: z.array(z.string()).min(1),
  }),
]);
export type ImportPreview = z.infer<typeof ImportPreviewSchema>;

export const ImportRequestSchema = z
  .object({
    /** Folders for the package's logical resources, by name. Unbound ones need attention. */
    bindings: z.record(z.string(), z.string().min(1)).default({}),
    /** What the user grants. Nothing is granted that isn't named here. */
    grants: GrantsSchema.partial().optional(),
    /** Where this computer serves the base model; the default local runtime when absent. */
    model: ModelBindingSchema.optional(),
    /** Run the model check too, which loads the model once. */
    loadModel: z.boolean().default(true),
  })
  .strict();
export type ImportRequest = z.input<typeof ImportRequestSchema>;

export const BindRequestSchema = z
  .object({
    bindings: z.record(z.string(), z.string().min(1)).optional(),
    grants: GrantsSchema.partial().optional(),
    model: ModelBindingSchema.optional(),
  })
  .strict();
export type BindRequest = z.infer<typeof BindRequestSchema>;
