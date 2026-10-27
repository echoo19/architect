export type ShortcutAction = 'palette' | 'new-agent' | 'settings';

export interface KeyChord {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

const ACTIONS: Record<string, ShortcutAction> = {
  k: 'palette',
  n: 'new-agent',
  ',': 'settings',
};

/** The keys each action shows in menus; `Mod` is Command on macOS and Ctrl elsewhere. */
export const SHORTCUT_KEYS: Record<ShortcutAction, readonly string[]> = {
  palette: ['Mod', 'K'],
  'new-agent': ['Mod', 'N'],
  settings: ['Mod', ','],
};

/** Which app shortcut a key press means: Cmd on macOS, Ctrl elsewhere, with no other modifier. */
export function matchShortcut(chord: KeyChord, mac: boolean): ShortcutAction | null {
  const mod = mac ? chord.metaKey && !chord.ctrlKey : chord.ctrlKey && !chord.metaKey;
  if (!mod || chord.altKey || chord.shiftKey) return null;
  return ACTIONS[chord.key.toLowerCase()] ?? null;
}
