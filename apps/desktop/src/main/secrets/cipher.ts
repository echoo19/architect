import { safeStorage } from 'electron';
import type { Cipher } from './store';

/**
 * Electron's `safeStorage`: DPAPI on Windows, the Keychain on macOS, the desktop keyring on
 * Linux. Without a keyring, Linux would fall back to a fixed password, which protects nothing,
 * so that counts as unavailable.
 */
export const safeStorageCipher: Cipher = {
  async unavailableReason() {
    if (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text') {
      return 'no system keyring is running, so keys could only be stored unencrypted';
    }
    return (await safeStorage.isAsyncEncryptionAvailable())
      ? null
      : "the system's secure storage isn't available";
  },
  encrypt: (value) => safeStorage.encryptStringAsync(value),
  async decrypt(data) {
    const { result, shouldReEncrypt } = await safeStorage.decryptStringAsync(data);
    return { value: result, stale: shouldReEncrypt };
  },
};
