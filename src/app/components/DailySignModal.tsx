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

  const variant = Math.abs(
    [...sign.title].reduce((sum, char) => sum + char.charCodeAt(0), 0)
  ) % 4;

  return (
    <div className="daily-sign-backdrop" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
      <div
        className={`daily-sign-card daily-sign-variant-${variant}`}
        style={{ backgroundImage: `linear-gradient(180deg, rgba(12,18,28,0.12), rgba(12,18,28,0.42) 42%, rgba(12,18,28,0.76)), url("${sign.image}")` }}
      >
        <div className="daily-sign-fan" aria-hidden="true" />
        <div className="daily-sign-cloud" aria-hidden="true" />
        <div className="daily-sign-ornament daily-sign-ornament-left" aria-hidden="true">
          <span className="daily-sign-flower" />
          <span className="daily-sign-knot" />
          <span className="daily-sign-knot" />
          <span className="daily-sign-knot" />
        </div>
        <div className="daily-sign-ornament daily-sign-ornament-right" aria-hidden="true">
          <span className="daily-sign-flower" />
          <span className="daily-sign-knot" />
          <span className="daily-sign-knot" />
        </div>
        <div className="daily-sign-charm">
          <div className="daily-sign-hanger daily-sign-hanger-top" aria-hidden="true" />
          <div className="daily-sign-hanger daily-sign-hanger-bottom" aria-hidden="true" />
          <div className="daily-sign-tassel" aria-hidden="true" />
          <div className="daily-sign-paper">
            <div className="daily-sign-kicker">今日小签</div>
            <h2>{sign.title}</h2>
            <p className="daily-sign-text">{sign.text}</p>
            <p className="daily-sign-english" lang="en">{sign.english}</p>
          </div>
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
