export const EMOTE_IDS = ['wave', 'cheer', 'dance', 'point', 'thumbsUp'] as const;
export type EmoteId = (typeof EMOTE_IDS)[number];

export const QUICK_MESSAGE_IDS = ['needBricks', 'overHere', 'thanks', 'nice', 'letsBuild', 'canIJoin'] as const;
export type QuickMessageId = (typeof QUICK_MESSAGE_IDS)[number];

export function isEmoteId(v: unknown): v is EmoteId {
  return typeof v === 'string' && (EMOTE_IDS as readonly string[]).includes(v);
}

export function isQuickMessageId(v: unknown): v is QuickMessageId {
  return typeof v === 'string' && (QUICK_MESSAGE_IDS as readonly string[]).includes(v);
}
