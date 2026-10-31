import { z } from 'zod';
import { CodedError } from './errors';
import { ListedAttemptSchema } from './ipc-schemas';
import { TaskSchema } from './task';

/*
 * What a developer may browse of a field and a run (decision 084): the practice and check tasks
 * in full, the sealed splits by count alone, a run's practice and check attempts page by page,
 * and the files of a harness version. Nothing here reaches a sealed task or a locked-test attempt.
 */

/** The splits whose tasks can be read: practice (`train`) and check (`dev`). */
export const BrowsableSplitSchema = z.enum(['train', 'dev']);
export type BrowsableSplit = z.infer<typeof BrowsableSplitSchema>;

/** The splits shown by how many tasks they hold, and nothing else. */
export const CountedSplitSchema = z.enum(['calibration', 'test']);
export type CountedSplit = z.infer<typeof CountedSplitSchema>;

export type TaskSplit = BrowsableSplit | CountedSplit;

/**
 * A split asked for by name, held to the four that may be browsed. Any other, such as the
 * certificate's sealed `certify` split, is refused with `split_sealed`, whoever asks.
 */
export function browsedSplit(split: unknown): TaskSplit {
  if (split === 'train' || split === 'dev' || split === 'calibration' || split === 'test') {
    return split;
  }
  throw new CodedError(
    'split_sealed',
    `The tasks of "${String(split)}" can't be browsed: only the practice and check tasks can, and the calibration and test splits by count.`,
  );
}

/** A split's tasks; for a counted split, only how many there are. */
export const TaskListingSchema = z.discriminatedUnion('split', [
  z.object({
    split: z.literal('train'),
    count: z.number().int().nonnegative(),
    tasks: z.array(TaskSchema),
  }),
  z.object({
    split: z.literal('dev'),
    count: z.number().int().nonnegative(),
    tasks: z.array(TaskSchema),
  }),
  z.object({ split: z.literal('calibration'), count: z.number().int().nonnegative() }),
  z.object({ split: z.literal('test'), count: z.number().int().nonnegative() }),
]);
export type TaskListing = z.infer<typeof TaskListingSchema>;

/** How many attempts a page of a run's attempts holds at most. */
export const ATTEMPT_PAGE_SIZE = 50;

/** Which of a run's practice and check attempts to read, and from where in them. */
export const AttemptQuerySchema = z
  .object({
    round: z.number().int().positive().optional(),
    type: z.string().min(1).optional(),
    org: z.string().min(1).optional(),
    passed: z.boolean().optional(),
    /** Where the page starts: the `next` of the page before. Absent: the newest attempts. */
    cursor: z
      .string()
      .regex(/^(0|[1-9]\d{0,8})$/)
      .optional(),
  })
  .strict();
export type AttemptQuery = z.infer<typeof AttemptQuerySchema>;

/** A practice or check attempt, with its request and its task's organization. */
export const BrowsedAttemptSchema = ListedAttemptSchema.extend({
  org: z.string().optional(),
});
export type BrowsedAttempt = z.infer<typeof BrowsedAttemptSchema>;

/** One page of a run's attempts, newest first. */
export const AttemptPageSchema = z.object({
  attempts: z.array(BrowsedAttemptSchema),
  /** How many attempts match the query across every page. */
  total: z.number().int().nonnegative(),
  /** The cursor of the next page; null on the last. */
  next: z.string().nullable(),
});
export type AttemptPage = z.infer<typeof AttemptPageSchema>;

/** One file of a harness version as it is written in its folder. */
export const HarnessFileSchema = z.object({
  path: z.string().min(1),
  content: z.string(),
});
export type HarnessFile = z.infer<typeof HarnessFileSchema>;
