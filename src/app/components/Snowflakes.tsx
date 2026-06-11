'use client';

import { memo, useMemo, useEffect, useState } from 'react';

const SNOWFLAKE_COUNT = 100;
const SNOWFLAKE_SYMBOLS = ['❄', '❅', '❆', '✻', '✼', '❉', '✺', '✹', '✸', '✷', '✶', '✵', '✴', '✳', '✲', '✱', '*', '·', '•'];

type SnowflakeData = {
  symbol: string;
  opacity: number;
};

function SnowflakesInner() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  // useMemo 固定随机值，避免每次渲染产生不同 DOM
  const snowflakes = useMemo<SnowflakeData[]>(() => {
    return Array.from({ length: SNOWFLAKE_COUNT }, (_, i) => ({
      symbol: SNOWFLAKE_SYMBOLS[i % SNOWFLAKE_SYMBOLS.length],
      opacity: parseFloat((0.2 + Math.random() * 0.7).toFixed(2)),
    }));
  }, []);

  if (!mounted) return null;

  return (
    <div className="snowflakes">
      {snowflakes.map((sf, i) => (
        <div
          key={i}
          className="snowflake"
          style={{
            '--snowflake-opacity': sf.opacity,
            opacity: sf.opacity
          } as React.CSSProperties}
        >
          {sf.symbol}
        </div>
      ))}
    </div>
  );
}

export const Snowflakes = memo(SnowflakesInner);
Snowflakes.displayName = 'Snowflakes';
