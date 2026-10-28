/**
 * Every key the app can store, by ref, with the service it unlocks. The named services, the
 * refs of endpoints the user added (bound to their host) and the hosts each key may be sent to
 * live in @architect/shared, where the engine checks them too.
 */
export {
  isSecretRef,
  secretLabel,
  SECRET_REFS as SECRET_REF_NAMES,
  type SecretRef,
} from '@architect/shared';
