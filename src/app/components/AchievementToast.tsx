'use client';

export type AchievementToastItem = {
  id: string;
  icon: string;
  title: string;
  description: string;
};

type AchievementToastProps = {
  items: AchievementToastItem[];
};

export default function AchievementToast({ items }: AchievementToastProps) {
  if (items.length === 0) return null;

  return (
    <div className="achievement-stack" aria-live="polite">
      {items.map((item) => (
        <div key={item.id} className="achievement-toast">
          <span className="achievement-icon">{item.icon}</span>
          <span>
            <strong>{item.title}</strong>
            <small>{item.description}</small>
          </span>
        </div>
      ))}
    </div>
  );
}
