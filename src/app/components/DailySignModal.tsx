'use client';

import type { DailySign } from '../data/dailySigns';

type DailySignModalProps = {
  sign: DailySign | null;
  open: boolean;
  onAccept: () => void;
  onReroll: () => void;
  rerollDisabled: boolean;
};

export default function DailySignModal({
  sign,
  open,
  onAccept,
  onReroll,
  rerollDisabled,
}: DailySignModalProps) {
  if (!open || !sign) return null;

  return (
    <div className="daily-sign-backdrop" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
      <div
        className="daily-sign-card"
        style={{ backgroundImage: `linear-gradient(180deg, rgba(12,18,28,0.12), rgba(12,18,28,0.42) 42%, rgba(12,18,28,0.76)), url("${sign.image}")` }}
      >
        <div className="daily-sign-copy">
          <div className="daily-sign-kicker">今日小签</div>
          <h2>{sign.title}</h2>
          <p className="daily-sign-text">{sign.text}</p>
          <p className="daily-sign-english" lang="en">{sign.english}</p>
        </div>
        <div className="daily-sign-actions">
          <button
            className="daily-sign-button daily-sign-button-secondary"
            onClick={onReroll}
            disabled={rerollDisabled}
            title={rerollDisabled ? '明天再抽' : '再抽一张'}
          >
            再抽一张
          </button>
          <button className="daily-sign-button daily-sign-button-primary" onClick={onAccept}>
            🎐收下
          </button>
        </div>
      </div>
    </div>
  );
}
