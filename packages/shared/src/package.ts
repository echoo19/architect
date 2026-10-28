import { z } from 'zod';
import { ContractFileSchema, JobContractSchema } from './contract';
import { StudentTargetSchema } from './job';
import { ScoreSchema } from './lineage';
import { TypeResultSchema } from './report';
import { MethodSchema } from './run';
import { TrainingJobRecordSchema } from './training';

/**
 * A graduate package (format 2): one immutable version of an agent as a plain folder, or as a
 * `name.architect.zip` of the same files. `graduate.json` describes it; every other file is
 * listed in its integrity section. Nothing in it belongs to one computer: no endpoints, folders,
 * chats or keys. Those live in the local installation (docs/DECISIONS.md, decision 036).
 */
export const PACKAGE_SCHEMA = 2;
export const PACKAGE_KIND = 'architect.graduate';

/** How results measured by whoever trained the graduate are labelled wherever they appear. */
export const AUTHOR_EVALUATION_LABEL = "Evaluated on the author's configuration";
/** How checks run where a graduate is installed are labelled, so the two are never confused. */
export const INSTALL_CHECKS_LABEL = 'Installation checks on this computer';

const WINDOWS_DEVICE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/** Ids that become folder names: the same rule as the app's own ids, and never a device name. */
export const SafeIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/)
  .refine((id) => !WINDOWS_DEVICE.test(id), 'is a name Windows keeps for devices');

export const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);

const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._ -]{0,119}$/;
const MAX_PATH_CHARS = 240;

/**
 * Why a path can't name a file inside a package, or null when it can. Paths are relative, use
 * forward slashes, and every segment is a plain name that means the same file on Windows, macOS
 * and Linux: no `..`, no drive letters, no hidden files, no trailing dots or spaces, no device
 * names.
 */
export function packagePathProblem(path: string): string | null {
  if (path.length === 0) return 'is empty';
  if (path.length > MAX_PATH_CHARS) return `is longer than ${MAX_PATH_CHARS} characters`;
  if (path.includes('\\')) return 'uses a backslash';
  if (path.startsWith('/') || /^[A-Za-z]:/.test(path)) return 'is an absolute path';
  for (const segment of path.split('/')) {
    if (segment === '..') return 'climbs out of the package with ".."';
    if (segment === '' || segment === '.') return 'has an empty or "." segment';
    if (!SEGMENT.test(segment)) return `has a segment, "${segment}", that isn't a plain file name`;
    if (/[. ]$/.test(segment)) return `has a segment, "${segment}", that ends in a dot or space`;
    if (WINDOWS_DEVICE.test(segment)) return `uses "${segment}", a name Windows keeps for devices`;
  }
  return null;
}

export const PackagePathSchema = z.string().superRefine((path, ctx) => {
  const problem = packagePathProblem(path);
  if (problem !== null) ctx.addIssue({ code: 'custom', message: `"${path}" ${problem}` });
});

/** A version of an agent, wherever it was made. */
export const VersionRefSchema = z
  .object({
    agentId: SafeIdSchema,
    version: z.number().int().positive(),
    /** sha256 of that version's `graduate.json`, when it is known. */
    digest: Sha256Schema.optional(),
  })
  .strict();
export type VersionRef = z.infer<typeof VersionRefSchema>;

export const PackageIdentitySchema = z
  .object({
    agentId: SafeIdSchema,
    name: z.string().min(1).max(60),
    version: z.number().int().positive(),
    /** The version this one was derived from; absent for an agent's first version. */
    parent: VersionRefSchema.optional(),
    createdAt: z.iso.datetime(),
    /** How it was made. */
    method: MethodSchema,
  })
  .strict();
export type PackageIdentity = z.infer<typeof PackageIdentitySchema>;

/** The base weights, named the way runtimes and hubs name them, pinned to one exact build. */
export const BaseModelSchema = z
  .object({
    /** The name runtimes serve it under, e.g. `muse-glimmer:30b`. */
    name: z.string().min(1),
    /** The weights' content digest as the runtime reported it. */
    digest: z.string().min(1).optional(),
    /** The repository revision, when the weights came from a hub. */
    revision: z.string().min(1).optional(),
    quantization: z.string().min(1).optional(),
    format: z.enum(['gguf', 'safetensors']).optional(),
    sizeBytes: z.number().int().nonnegative().optional(),
  })
  .strict();
export type BaseModel = z.infer<typeof BaseModelSchema>;

/**
 * How Ollama's store and the adapter runtime (decision 035) name a weights file: `sha256:` and
 * the file's digest, the same on every computer.
 */
export const BlobDigestSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/);

/**
 * A LoRA adapter, named the way the adapter runtime (decision 035) checks and loads one: the GGUF
 * file by its sha256, the base build it was made for by that build's GGUF digest, and the scale
 * every request applies it at.
 */
export const AdapterRefSchema = z
  .object({
    path: PackagePathSchema,
    /** A GGUF LoRA, the format llama.cpp loads. */
    format: z.literal('gguf_lora'),
    /** The adapter file's sha256, as its integrity entry and its training job record it. */
    sha256: Sha256Schema,
    sizeBytes: z.number().int().nonnegative(),
    /**
     * The base weights it was made for: the digest of the GGUF file that Ollama's store holds for
     * `model.base.name`. It loads on no other build.
     */
    baseDigest: BlobDigestSchema,
    /** How strongly each request applies it, as measured: 1 is the adapter as trained. */
    scale: z.number().positive(),
    /** The training job that made it, when one did. */
    trainingJobId: TrainingJobRecordSchema.shape.id.optional(),
    /** Made by the stand-in training backend: built, never trained (decision 033). */
    standIn: z.literal(true).optional(),
  })
  .strict();
export type AdapterRef = z.infer<typeof AdapterRefSchema>;

/** Local runtimes this build of Architect can run a graduate on. */
export const KNOWN_RUNTIMES = ['ollama', 'openai_compatible', 'llama.cpp'] as const;
export type RuntimeName = (typeof KNOWN_RUNTIMES)[number];

export function isKnownRuntime(name: string): name is RuntimeName {
  return (KNOWN_RUNTIMES as readonly string[]).includes(name);
}

/** Runtimes that load a LoRA adapter on top of the base weights (decision 031). */
export const ADAPTER_RUNTIMES: readonly RuntimeName[] = ['llama.cpp'];

export const PackageModelSchema = z
  .object({
    /** The short name people know the model by, e.g. "Glimmer". */
    label: z.string().min(1),
    base: BaseModelSchema,
    adapter: AdapterRefSchema.optional(),
    inference: z.object({ contextLength: z.number().int().min(2048).max(262_144) }).strict(),
    runtime: z
      .object({
        /** Runtimes the graduate runs on, best first. Names this build doesn't know are kept. */
        compatible: z.array(z.string().min(1)).min(1),
      })
      .strict(),
  })
  .strict();
export type PackageModel = z.infer<typeof PackageModelSchema>;

export const PackageHarnessSchema = z
  .object({
    /** The harness folder format its files follow. */
    format: z.number().int().positive(),
    path: z.literal('harness'),
    /** The harness content hash, as `@architect/harness` computes it. */
    hash: z.string().min(1),
    /** Its version number in the run that made it. */
    version: z.number().int().nonnegative(),
    /** The round whose kept change made it; absent for a starting harness. */
    round: z.number().int().positive().optional(),
    /** That round wrote a whole draft rather than one change. */
    draft: z.literal(true).optional(),
    /**
     * When the harness was made in an older format and migrated since: that format, and the hash
     * it had then, which its run and its locked test recorded. The files here are the migrated
     * ones, and `hash` is theirs.
     */
    migratedFrom: z
      .object({ format: z.number().int().positive(), hash: z.string().min(1) })
      .strict()
      .optional(),
  })
  .strict();
export type PackageHarness = z.infer<typeof PackageHarnessSchema>;

export const ResourceNameSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]{0,39}$/)
  .refine((name) => !WINDOWS_DEVICE.test(name), 'is a name Windows keeps for devices');

export const ResourceFileSchema = ContractFileSchema.extend({
  /** A table's header as the author's file had it; a check compares a bound file with it. */
  columns: z.array(z.string()).optional(),
}).strict();
export type ResourceFile = z.infer<typeof ResourceFileSchema>;

/**
 * A folder the graduate works in, by logical name (`data`, `output`, or a named resource). Each
 * installation binds it to a folder of its own; the package only says what it needs and asks.
 */
export const PackageResourceSchema = z
  .object({
    name: ResourceNameSchema,
    kind: z.literal('folder'),
    required: z.boolean(),
    description: z.string(),
    /** Media types its files may have. */
    accepts: z.array(z.string().min(1)).min(1),
    /** What the graduate asks to do with it: a request, never a grant. */
    access: z.enum(['read', 'read_write']),
    /** The files the contract names in it. */
    files: z.array(ResourceFileSchema),
    /** Present only when the author chose to ship the folder's files in the package. */
    bundled: z
      .object({ path: PackagePathSchema, provenance: z.string().min(1) })
      .strict()
      .optional(),
  })
  .strict();
export type PackageResource = z.infer<typeof PackageResourceSchema>;

export const TestedConfigurationSchema = z
  .object({
    /** `process.platform` and `process.arch` of the computer that ran the locked test. */
    os: z.string().min(1),
    arch: z.string().min(1),
    /** The runtime that served the student, or `hosted` for a hosted copy. */
    backend: z.string().min(1),
    target: StudentTargetSchema,
    memoryBytes: z.number().int().positive().optional(),
  })
  .strict();
export type TestedConfiguration = z.infer<typeof TestedConfigurationSchema>;

export const PackageRequirementsSchema = z
  .object({
    tested: z.array(TestedConfigurationSchema),
    measured: z
      .object({
        latencyMs: z
          .object({ p50: z.number().nonnegative(), p95: z.number().nonnegative() })
          .strict()
          .optional(),
      })
      .strict(),
    /** Estimates from the model's size, not measurements. */
    minimum: z
      .object({
        memoryBytes: z.number().int().positive().optional(),
        diskBytes: z.number().int().positive().optional(),
      })
      .strict(),
    limitations: z.array(z.string()),
  })
  .strict();
export type PackageRequirements = z.infer<typeof PackageRequirementsSchema>;

export const EvaluationStatusSchema = z.enum(['ready', 'experimental', 'unevaluated']);
export type EvaluationStatus = z.infer<typeof EvaluationStatusSchema>;

const MetSchema = z.object({ target: z.number(), actual: z.number(), met: z.boolean() }).strict();

export const PackageEvidenceSchema = z
  .object({
    label: z.literal(AUTHOR_EVALUATION_LABEL),
    /**
     * `ready` when the locked test met the contract's bar on a local student; `experimental`
     * when it fell short or ran on a hosted copy; `unevaluated` when no locked test measured it.
     */
    status: EvaluationStatusSchema,
    /** The contract version the result was measured against. It says nothing about any other. */
    contractVersion: z.number().int().positive(),
    summary: z
      .object({
        score: ScoreSchema,
        perType: z.array(TypeResultSchema),
        passRate: MetSchema,
        p95LatencyMs: MetSchema.optional(),
      })
      .strict()
      .optional(),
    counts: z
      .object({
        testTasks: z.number().int().nonnegative(),
        rounds: z.number().int().nonnegative(),
        keptChanges: z.number().int().nonnegative(),
      })
      .strict(),
    provenance: z
      .object({
        method: MethodSchema,
        mentor: z.object({ label: z.string(), model: z.string() }).strict(),
        student: z.object({ label: z.string(), model: z.string(), runtime: z.string() }).strict(),
        testedOn: StudentTargetSchema,
        ranOffline: z.boolean(),
        jobId: z.string().min(1),
        runId: z.string().min(1),
        evaluatedAt: z.iso.datetime(),
      })
      .strict()
      .optional(),
    /** The report card and the change history, without traces or task text. */
    files: z
      .object({
        report: PackagePathSchema,
        reportMarkdown: PackagePathSchema,
        lineage: PackagePathSchema,
      })
      .strict()
      .optional(),
  })
  .strict();
export type PackageEvidence = z.infer<typeof PackageEvidenceSchema>;

/**
 * Checks any installation can run, with no private data and nothing from the locked test. Their
 * results are the installation's, never the author's evidence.
 */
export const SmokeCheckSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9-]{0,59}$/),
    kind: z.enum([
      'harness_valid',
      'tools_load',
      'resources_bound',
      'model_available',
      'model_responds',
    ]),
    description: z.string().min(1),
  })
  .strict();
export type SmokeCheck = z.infer<typeof SmokeCheckSchema>;

export const PackageVerificationSchema = z
  .object({
    checks: z.array(SmokeCheckSchema),
    /** Small, non-sensitive files the checks may use. */
    fixtures: z.array(z.object({ path: PackagePathSchema, description: z.string() }).strict()),
  })
  .strict();
export type PackageVerification = z.infer<typeof PackageVerificationSchema>;

export const IntegrityEntrySchema = z
  .object({
    path: PackagePathSchema,
    sha256: Sha256Schema,
    size: z.number().int().nonnegative(),
  })
  .strict();
export type IntegrityEntry = z.infer<typeof IntegrityEntrySchema>;

export const PackageIntegritySchema = z
  .object({
    algorithm: z.literal('sha256'),
    /** Every file in the package except `graduate.json`, in path order. */
    files: z.array(IntegrityEntrySchema),
  })
  .strict();
export type PackageIntegrity = z.infer<typeof PackageIntegritySchema>;

export const PackageTermsSchema = z
  .object({
    /** The package's own licence, when its author named one. */
    license: z.string().min(1).optional(),
    /** How the base model's own terms apply. Its weights are never in the package. */
    baseModel: z.string().min(1),
    notices: z.array(z.string()),
  })
  .strict();
export type PackageTerms = z.infer<typeof PackageTermsSchema>;

/** `graduate.json`. Its keys are snake_case on disk, like every other Architect file. */
export const PackageManifestSchema = z
  .object({
    schema: z.literal(PACKAGE_SCHEMA),
    kind: z.literal(PACKAGE_KIND),
    identity: PackageIdentitySchema,
    contract: JobContractSchema,
    model: PackageModelSchema,
    harness: PackageHarnessSchema,
    resources: z.array(PackageResourceSchema),
    requirements: PackageRequirementsSchema,
    evidence: PackageEvidenceSchema,
    verification: PackageVerificationSchema,
    integrity: PackageIntegritySchema,
    terms: PackageTermsSchema,
  })
  .strict()
  .superRefine((manifest, ctx) => {
    const adapter = manifest.model.adapter;
    if (adapter === undefined) return;
    const listed = manifest.integrity.files.find((file) => file.path === adapter.path);
    if (listed?.sha256 !== adapter.sha256 || listed.size !== adapter.sizeBytes) {
      ctx.addIssue({
        code: 'custom',
        path: ['model', 'adapter'],
        message:
          'names a file that the integrity section lists with another checksum, or not at all',
      });
    }
  });
export type PackageManifest = z.infer<typeof PackageManifestSchema>;
