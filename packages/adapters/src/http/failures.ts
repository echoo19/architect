import type { AdapterErrorCode } from '@architect/shared';

/** What went wrong in plain words, with the next step kept apart so a connection test can show both. */
export interface Failure {
  code: AdapterErrorCode;
  summary: string;
  hint?: string;
}

export interface StatusContext {
  /** Who answered, as a person would name it: "Meta", "Ollama", "api.together.ai". */
  service: string;
  /** The model the request asked for, when the request names one. */
  model?: string;
  /** What to do when that model is missing. */
  modelNotFoundHint?: string;
  /** The message from the server's error body, already scrubbed of secrets. */
  detail?: string;
  /** The machine-readable code from the server's error body. */
  serverCode?: string;
  retryAfterMs?: number;
}

const DETAIL_LIMIT = 300;
const TLS_CODE = /CERT|TLS|SSL|SELF_SIGNED|UNABLE_TO_VERIFY/;
const TIMEOUT_CODES = new Set([
  'ETIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
]);

export function failureForStatus(status: number, ctx: StatusContext): Failure {
  const { service } = ctx;
  const at = `(HTTP ${status})`;

  switch (status) {
    case 401:
      return {
        code: 'auth',
        summary: `${service} didn't accept the API key ${at}.`,
        hint: 'Check the key in Settings.',
      };
    case 403:
      return {
        code: 'auth',
        summary: `${service} won't let this key do that ${at}.`,
        hint: 'Check the key in Settings, and that it can use this model.',
      };
    case 402:
      return {
        code: 'quota',
        summary: `${service} says the account has no credit or no billing set up ${at}.`,
        hint: 'Add credit with the provider, then try again.',
      };
    case 404:
      return ctx.model === undefined
        ? {
            code: 'not_found',
            summary: `${service} has nothing at that address ${at}.`,
            hint: 'Check the base URL.',
          }
        : {
            code: 'not_found',
            summary: `${service} has no model "${ctx.model}" ${at}.`,
            hint: ctx.modelNotFoundHint ?? 'Check the model id in the job settings.',
          };
    case 408:
      return {
        code: 'timeout',
        summary: `${service} gave up waiting for the request ${at}.`,
        hint: 'Try again.',
      };
    case 413:
      return {
        code: 'bad_request',
        summary: `${service} says the request is too large ${at}.`,
        hint: 'Shorten the input or lower the output limit.',
      };
    case 429:
      return {
        code: 'rate_limit',
        summary: `${service} is rate limiting requests ${at}.`,
        hint:
          ctx.retryAfterMs === undefined
            ? 'Wait a moment and try again.'
            : `It asked for a wait of ${formatSeconds(ctx.retryAfterMs)}.`,
      };
    case 504:
      return {
        code: 'server',
        summary: `${service} gave up waiting for the model ${at}.`,
        hint: 'Lower the reasoning effort or the output limit.',
      };
    default:
      return failureForOtherStatus(status, ctx);
  }
}

function failureForOtherStatus(status: number, ctx: StatusContext): Failure {
  const { service, detail } = ctx;
  const at = `(HTTP ${status})`;

  if (status >= 500) {
    return {
      code: 'server',
      summary: withDetail(`${service} had a problem on its side ${at}.`, detail),
      hint: 'This is usually temporary. Try again in a minute.',
    };
  }
  if (status === 400 && ctx.serverCode === 'content_policy_violation') {
    return {
      code: 'blocked',
      summary: withDetail(`${service} blocked the request ${at}.`, detail),
      hint: 'Change the content and try again.',
    };
  }
  if (status >= 400) {
    const verb = status === 400 ? 'rejected' : 'refused';
    return {
      code: 'bad_request',
      summary: withDetail(`${service} ${verb} the request ${at}.`, detail),
    };
  }
  return { code: 'bad_response', summary: `${service} sent an unexpected reply ${at}.` };
}

/** `fetch` reports socket problems as a generic TypeError whose `cause` carries the real code. */
export function failureForNetworkError(error: unknown, service: string): Failure {
  const code = errorCode(error);
  if (code === 'ECONNREFUSED') {
    return {
      code: 'network',
      summary: `Couldn't connect to ${service}.`,
      hint: 'Check that it is running and that the address is right.',
    };
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return {
      code: 'network',
      summary: `Couldn't find ${service} on the network.`,
      hint: 'Check the address and your internet connection.',
    };
  }
  if (code === 'ERR_INVALID_URL') {
    return {
      code: 'bad_request',
      summary: `The address for ${service} isn't a valid URL.`,
      hint: 'Check it in the job settings.',
    };
  }
  if (TLS_CODE.test(code)) {
    return {
      code: 'network',
      summary: `Couldn't make a secure connection to ${service}.`,
      hint: 'Check the address, the clock on this computer, and any proxy that inspects traffic.',
    };
  }
  if (TIMEOUT_CODES.has(code)) return timeoutFailure(service);
  return {
    code: 'network',
    summary: `The connection to ${service} dropped.`,
    hint: 'Check your connection and try again.',
  };
}

export function timeoutFailure(service: string, silentMs?: number): Failure {
  const wait = silentMs === undefined ? '' : ` for ${formatSeconds(silentMs)}`;
  return { code: 'timeout', summary: `${service} stopped responding${wait}.`, hint: 'Try again.' };
}

/** Seconds to wait, from `Retry-After` (seconds or an HTTP date) or `retry-after-ms`. */
export function parseRetryAfter(headers: Headers, now: number = Date.now()): number | undefined {
  const millisHeader = headers.get('retry-after-ms');
  if (millisHeader !== null) {
    const millis = Number(millisHeader);
    if (Number.isFinite(millis) && millis >= 0) return Math.round(millis);
  }
  const value = headers.get('retry-after')?.trim();
  if (!value) return undefined;
  if (/^\d+(\.\d+)?$/.test(value)) return Math.round(Number(value) * 1000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}

/** Pulls the human message and machine code out of the error shapes providers use. */
export function describeErrorBody(text: string): { message?: string; code?: string } {
  const trimmed = text.trim();
  if (trimmed === '') return {};

  let body: unknown;
  try {
    body = JSON.parse(trimmed);
  } catch {
    return trimmed.startsWith('<') ? {} : { message: clip(trimmed) };
  }
  if (typeof body === 'string') return { message: clip(body) };
  if (!isRecord(body)) return {};

  const error = body['error'];
  const found =
    typeof error === 'string'
      ? { message: error, code: body['code'] }
      : isRecord(error)
        ? { message: error['message'], code: error['code'] ?? error['type'] }
        : { message: body['message'] ?? detailText(body['detail']), code: body['code'] };

  const result: { message?: string; code?: string } = {};
  if (typeof found.message === 'string' && found.message.trim() !== '') {
    result.message = clip(found.message);
  }
  if (typeof found.code === 'string' || typeof found.code === 'number') {
    result.code = String(found.code);
  }
  return result;
}

/** Replaces every occurrence of a secret so an echoed key can't reach a message or a log. */
export function redact(text: string, secrets: readonly string[]): string {
  let clean = text;
  for (const secret of secrets) {
    if (secret.length >= 6) clean = clean.split(secret).join('[redacted]');
  }
  return clean;
}

export function formatSeconds(ms: number): string {
  const seconds = Math.max(1, Math.round(ms / 1000));
  return seconds === 1 ? '1 second' : `${seconds} seconds`;
}

function withDetail(summary: string, detail: string | undefined): string {
  if (detail === undefined || detail === '') return summary;
  return `${summary} ${/[.!?]$/.test(detail) ? detail : `${detail}.`}`;
}

function clip(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > DETAIL_LIMIT ? `${flat.slice(0, DETAIL_LIMIT - 1)}…` : flat;
}

function detailText(detail: unknown): string | undefined {
  if (typeof detail === 'string') return detail;
  if (!Array.isArray(detail)) return undefined;
  const messages = detail.flatMap((item) =>
    isRecord(item) && typeof item['msg'] === 'string' ? [item['msg']] : [],
  );
  return messages.length > 0 ? messages.join('; ') : undefined;
}

function errorCode(error: unknown): string {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && isRecord(current); depth++) {
    if (typeof current['code'] === 'string') return current['code'];
    current = current['cause'];
  }
  return '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
