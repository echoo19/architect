import type { SidebarAgent } from './frame';

/**
 * What the workspace windows show: one made-up shop, Larchwood Outfitters, and the returns desk
 * agent that works its records. Every figure in a chat is one the shop's own records and rules
 * give.
 */

export const DESK = 'Returns desk';

/** The chats of the returns desk in the order the sidebar lists them, newest first. */
export const CHATS = [
  "Can Nico's tent come back?",
  'What has Marcus spent on tents?',
  "Can Vera's pot sets come back?",
] as const;

/**
 * The sidebar: the agent and its chats, with one open and, optionally, one that is waiting for the
 * person to allow a change.
 */
export function deskSidebar(
  titles: readonly string[],
  open: number,
  waiting?: number,
): SidebarAgent[] {
  return [
    {
      name: DESK,
      chats: titles.map((title, index) => ({
        title,
        ...(index === open ? { current: true } : {}),
        ...(index === waiting ? { awaitsApproval: true } : {}),
      })),
    },
  ];
}
