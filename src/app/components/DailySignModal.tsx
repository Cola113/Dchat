'use client';

import type { DailySign } from '../data/dailySigns';

type DailySignModalProps = {
  sign: DailySign | null;
  open: boolean;
  onAccept: () => void;
};

export default function DailySignModal({ sign, open, onAccept }: DailySignModalProps) {
  if (!open || !sign) return null;

  return (
    <div className="daily-sign-backdrop" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
      <div
        className="daily-sign-card"
        style={{ backgroundImage: `linear-gradient(180deg, rgba(17,24,39,0.08), rgba(17,24,39,0.62)), url("${sign.image}")` }}
      >
        <div className="daily-sign-copy">
          <div className="daily-sign-kicker">今日小签</div>
          <h2>{sign.title}</h2>
          <p>{sign.text}</p>
        </div>
        <button className="daily-sign-button" onClick={onAccept}>
          🎐收下
        </button>
      </div>
    </div>
  );
}
