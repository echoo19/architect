/**
 * Every key the app can store, by ref, with the service it unlocks. Jobs and settings name a key
 * by its ref (`secretRef`), never by its value.
 */
export const SECRET_REFS = {
  meta: 'Meta Model API',
  baseten: 'Baseten',
  modal: 'Modal',
  together: 'Together',
  openrouter: 'OpenRouter',
  deepinfra: 'DeepInfra',
} as const;

export type SecretRef = keyof typeof SECRET_REFS;

export const SECRET_REF_NAMES = Object.keys(SECRET_REFS) as [SecretRef, ...SecretRef[]];

export function isSecretRef(ref: string): ref is SecretRef {
  return Object.hasOwn(SECRET_REFS, ref);
}
