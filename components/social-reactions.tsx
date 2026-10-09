"use client";

import { REACTIONS, type ReactionEmoji, type SocialActivity } from "@/lib/social/model";

const LABELS: Record<ReactionEmoji, string> = { "💪": "strong", "🔥": "fire", "👏": "applause", "😂": "laughing", "❤️": "heart" };

export function applyReaction(activity: SocialActivity, next: ReactionEmoji | null): SocialActivity {
  const reactions = { ...activity.reactions };
  if (activity.myReaction) reactions[activity.myReaction] = Math.max(0, (reactions[activity.myReaction] ?? 0) - 1);
  if (next) reactions[next] = (reactions[next] ?? 0) + 1;
  return { ...activity, myReaction: next, reactions };
}

export function SocialReactions({ activity, onReact }: { activity: SocialActivity; onReact: (emoji: ReactionEmoji) => void }) {
  return <div className="reaction-row">{REACTIONS.map((emoji) => <button key={emoji} type="button"
    aria-label={`React with ${LABELS[emoji]}`} aria-pressed={activity.myReaction === emoji}
    onClick={() => onReact(emoji)}>{emoji}<span>{activity.reactions[emoji] || ""}</span></button>)}</div>;
}
