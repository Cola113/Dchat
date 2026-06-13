'use client';

import { useEffect, useMemo, useState } from 'react';

export type AvatarMood =
  | 'user'
  | 'idle'
  | 'thinking'
  | 'happy'
  | 'caring'
  | 'curious'
  | 'image'
  | 'tarot'
  | 'focused'
  | 'sleepy'
  | 'error'
  | 'spark';

const moodFrames: Record<AvatarMood, string[]> = {
  user: ['🐮', '🙂', '😎', '🌟'],
  idle: ['😊', '🤖', '🙂', '😌', '✨'],
  thinking: ['🤔', '🫧', '💭', '👀', '✨'],
  happy: ['😄', '🤭', '🥳', '😊', '😆'],
  caring: ['🥺', '🤲', '🫶', '😌', '🌙'],
  curious: ['🧐', '👀', '🤨', '🔎', '💡'],
  image: ['🧐', '🖼️', '👁️', '📷', '✨'],
  tarot: ['🔮', '🌙', '🃏', '✨', '🪄'],
  focused: ['🧠', '✍️', '📌', '💡', '🤓'],
  sleepy: ['😴', '🌙', '☕', '🫧', '😌'],
  error: ['😵', '🥲', '🫠', '😶‍🌫️', '⚠️'],
  spark: ['✨', '🌟', '🎐', '🫧', '💫'],
};

function hashString(value: string) {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

type EmojiAvatarProps = {
  mood: AvatarMood;
  seed?: string;
  active?: boolean;
};

export default function EmojiAvatar({ mood, seed = '', active = false }: EmojiAvatarProps) {
  const frames = moodFrames[mood] || moodFrames.idle;
  const staticIndex = useMemo(() => hashString(`${mood}:${seed}`) % frames.length, [frames.length, mood, seed]);
  const [mounted, setMounted] = useState(false);
  const [frameIndex, setFrameIndex] = useState(staticIndex);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    setFrameIndex(staticIndex);
  }, [staticIndex]);

  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => {
      setFrameIndex((current) => (current + 1) % frames.length);
    }, 650);

    return () => window.clearInterval(timer);
  }, [active, frames.length]);

  const renderedMood = mounted ? mood : 'idle';
  const renderedFrames = moodFrames[renderedMood] || moodFrames.idle;
  const renderedFrameIndex = mounted ? frameIndex % renderedFrames.length : 0;
  const renderedActive = mounted && active;

  return (
    <span className={`emoji-avatar emoji-avatar-${renderedMood} ${renderedActive ? 'emoji-avatar-active' : ''}`}>
      {renderedFrames[renderedFrameIndex]}
    </span>
  );
}
