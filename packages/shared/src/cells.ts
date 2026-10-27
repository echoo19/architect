import { z } from 'zod';

export const CellValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
