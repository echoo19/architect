import { SECRET_REFS, SECRET_SERVICES, isSecretRef, type SecretRef } from '@architect/shared';

/**
 * Every key the app can store, by ref, with the service it unlocks. The list and the hosts each
 * key may be sent to live in @architect/shared, where the engine checks them too.
 */
export { isSecretRef, type SecretRef };

export const SECRET_REF_NAMES = SECRET_REFS;

export function secretLabel(ref: SecretRef): string {
  return SECRET_SERVICES[ref].label;
}
