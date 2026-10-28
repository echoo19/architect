import type { ModelEntry, PriceRates, TokenPricing } from '@architect/shared';
import { z } from 'zod';
import type { HttpClient } from '../http/client';

/** OpenRouter writes prices as strings of US dollars per token. */
const Price = z.string();

/**
 * A price that applies under a condition: a prompt of at least `min_prompt_tokens`, or certain
 * days and hours (`utc_days`, `utc_start`, `utc_end`), when some providers charge more.
 */
const OverrideWire = z.object({
  min_prompt_tokens: z.number().int().positive().nullish(),
  prompt: Price,
  completion: Price,
  input_cache_read: Price.nullish(),
});

const PricingWire = z.object({
  prompt: Price,
  completion: Price,
  input_cache_read: Price.nullish(),
  overrides: z.array(OverrideWire).nullish(),
});
type PricingWire = z.output<typeof PricingWire>;

const OpenRouterModelWire = z.object({
  id: z.string(),
  name: z.string().nullish(),
  context_length: z.number().int().positive().nullish(),
  pricing: PricingWire.nullish(),
});

/** The list as sent; each model is read on its own, so one odd entry can't hide the rest. */
const OpenRouterListWire = z.object({ data: z.array(z.unknown()) });

/** Dollars per token as dollars per million, rounded so 0.0000003 reads 0.3. */
function perMillion(price: string): number | null {
  const value = Number(price);
  // A negative price marks a router whose cost depends on where it sends the request.
  if (price.trim() === '' || !Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 1e12) / 1e6;
}

function ratesOf(price: z.output<typeof OverrideWire>): PriceRates | null {
  const input = perMillion(price.prompt);
  const output = perMillion(price.completion);
  if (input === null || output === null) return null;
  const cached = price.input_cache_read ? perMillion(price.input_cache_read) : input;
  return { inputPerM: input, cachedInputPerM: cached ?? input, outputPerM: output };
}

function highest(rates: readonly PriceRates[]): PriceRates {
  return {
    inputPerM: Math.max(...rates.map((rate) => rate.inputPerM)),
    cachedInputPerM: Math.max(...rates.map((rate) => rate.cachedInputPerM)),
    outputPerM: Math.max(...rates.map((rate) => rate.outputPerM)),
  };
}

/**
 * A model's listed price, the one the dollar cap is kept with; null when it has no fixed price.
 * Where some hours cost more, the dearest hour's price is used, so the cap holds at any hour.
 * The first prompt-length override becomes the long-prompt rates.
 */
export function openRouterPricing(pricing: PricingWire | null | undefined): TokenPricing | null {
  if (!pricing) return null;
  const base = ratesOf(pricing);
  if (!base) return null;
  const overrides = pricing.overrides ?? [];
  const timed = overrides
    .filter((override) => override.min_prompt_tokens == null)
    .map(ratesOf)
    .filter((rates): rates is PriceRates => rates !== null);
  const result: TokenPricing = highest([base, ...timed]);

  const long = overrides
    .filter((override) => typeof override.min_prompt_tokens === 'number')
    .sort((a, b) => (a.min_prompt_tokens ?? 0) - (b.min_prompt_tokens ?? 0))[0];
  const longRates = long ? ratesOf(long) : null;
  if (long?.min_prompt_tokens && longRates) {
    result.longContext = { aboveInputTokens: long.min_prompt_tokens - 1, ...longRates };
  }
  return result;
}

const KeyInfoWire = z.object({ data: z.object({}) });

/** Asks OpenRouter whether a key is good, which its public catalogue can't say. */
export async function checkOpenRouterKey(http: HttpClient, signal?: AbortSignal): Promise<void> {
  await http.getJson('/key', KeyInfoWire, { signal });
}

/** OpenRouter's catalogue, with each model's name and listed price. It needs no key. */
export async function listOpenRouterModels(
  http: HttpClient,
  signal?: AbortSignal,
): Promise<ModelEntry[]> {
  const { data } = await http.getJson('/models', OpenRouterListWire, { signal, timeoutMs: 30_000 });
  return data.flatMap((raw) => {
    const parsed = OpenRouterModelWire.safeParse(raw);
    if (!parsed.success) return [];
    const model = parsed.data;
    const entry: ModelEntry = { id: model.id };
    if (model.name) entry.label = model.name;
    if (model.context_length) entry.contextLength = model.context_length;
    const pricing = openRouterPricing(model.pricing);
    if (pricing) entry.pricing = pricing;
    return [entry];
  });
}
