import { z } from 'zod';
import { loopbackEndpointIssue } from './net';
import { ReportCardSchema } from './report';

/*
 * Bringing a trained model back (docs/SCALE.md, decision 086): a model trained elsewhere and
 * served on this computer as an OpenAI-compatible endpoint takes a finished run's locked test,
 * its never-seen organizations included, under that run's frozen harness. Its card is the
 * model's evidence; it costs no money and the run is never changed.
 */

/** An OpenAI-compatible server on this computer: loopback, with a port, and a model name. */
export const LocalEndpointSchema = z.object({
  baseUrl: z
    .string()
    .trim()
    .superRefine((value, context) => {
      const issue = loopbackEndpointIssue(value);
      if (issue !== null) context.addIssue({ code: 'custom', message: issue });
    }),
  model: z.string().trim().min(1, 'Name the model the server serves.'),
  contextLength: z.number().int().min(2048).max(262_144).default(16_384),
});
export type LocalEndpoint = z.infer<typeof LocalEndpointSchema>;

export const QualifyRequestSchema = z.object({
  /** The finished run whose frozen version takes the test. */
  runId: z.string().min(1),
  endpoint: LocalEndpointSchema,
});
export type QualifyRequest = z.infer<typeof QualifyRequestSchema>;

export const QualificationStatusSchema = z.enum(['testing', 'paused', 'finished']);
export type QualificationStatus = z.infer<typeof QualificationStatusSchema>;

export const QualificationSchema = z.object({
  id: z.string(),
  runId: z.string(),
  jobId: z.string(),
  /** The harness version that was frozen and tested. */
  harnessVersion: z.number().int().positive(),
  /** The model the endpoint serves, as the person named it. */
  model: z.string(),
  baseUrl: z.string(),
  status: QualificationStatusSchema,
  /** Why it paused. */
  error: z.string().optional(),
  /** The locked test's card, once finished. */
  card: ReportCardSchema.optional(),
  startedAt: z.iso.datetime(),
  endedAt: z.iso.datetime().optional(),
});
export type Qualification = z.infer<typeof QualificationSchema>;
