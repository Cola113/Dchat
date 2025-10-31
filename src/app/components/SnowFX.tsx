'use client';
import { useEffect, useRef } from 'react';

type Flake = {
  x0: number;    // 基准 x（用于在其上左右摆动）
  y: number;     // 竖直位置
  z: number;     // 0..1 深度（近景更大更亮更快）
  size: number;  // 字体像素大小
  vy: number;    // 下落速度 px/s
  amp: number;   // 左右摆动幅度 px
  freq: number;  // 左右摆动频率 rad/s
  phase: number; // 左右摆动相位
  spin: number;  // 旋转速度 rad/s
  glyph: string; // 字符
};

const GLYPHS = ['❄', '❅', '❆', '✻', '✼', '❉', '*', '·', '•'];

export default function SnowFX({ density = 1 }: { density?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const prefersReduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    let raf = 0;

    // 风只向一个方向（右）吹，强度随时间变化
    let wind = 0;          // 当前风速 px/s（>0 向右）
    let windTarget = 30;   // 目标风速
    let windOffset = 0;    // 随时间积分的水平偏移（形成持续向右的漂移）

    let last = performance.now();
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1)); // 限 2 省电

    const getViewSize = () => {
      const rect = canvas.getBoundingClientRect();
      return {
        w: rect.width || window.innerWidth,
        h: rect.height || window.innerHeight,
      };
    };

    const resize = () => {
      const { w, h } = getViewSize();
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // 用 CSS 像素作世界坐标
    };

    const flakes: Flake[] = [];
    const makeFlake = (w: number, h: number): Flake => {
      const z = Math.random();                  // 深度
      const size = 8 + z * 18;                  // 8~26 px
      const vy = 35 + z * 95;                   // 35~130 px/s
      const amp = 10 + z * 70;                  // 左右摆幅 10~80
      const freq = 0.6 + Math.random() * 1.4;   // 0.6~2.0
      const spin = (Math.random() - 0.5) * 0.6; // -0.3~0.3 rad/s
      const phase = Math.random() * Math.PI * 2;
      const x0 = Math.random() * w;
      const y = -Math.random() * h;             // 从屏上方随机进入
      const glyph = GLYPHS[(Math.random() * GLYPHS.length) | 0];
      return { x0, y, z, size, vy, amp, freq, phase, spin, glyph };
    };

    const ensureCount = () => {
      const { w, h } = getViewSize();
      // 更高密度：以面积自适应，分母减小 => 数量更多
      const target = Math.round(((w * h) / 4500) * density);
      while (flakes.length < target) flakes.push(makeFlake(w, h));
      if (flakes.length > target) flakes.length = target;
    };

    const scheduleWind = () => {
      // 只向右（正方向），强度在区间内变化
      windTarget = 15 + Math.random() * 60; // 15~75 px/s
      setTimeout(scheduleWind, 6000 + Math.random() * 6000);
    };

    const draw = (now: number) => {
      const dt = Math.min(0.033, (now - last) / 1000); // 限最大步长，避免切后台卡帧
      last = now;

      const w = canvas.width / dpr;
      const h = canvas.height / dpr;

      // 积分风偏移，形成持续向右漂移
      wind += (windTarget - wind) * Math.min(1, dt * 0.6);
      windOffset += wind * dt;

      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'lighter';

      // 远->近绘制
      flakes.sort((a, b) => a.z - b.z);

      for (const f of flakes) {
        f.y += f.vy * dt;

        // 左右摆动 + 随深度缩放的风偏移
        let x = f.x0
          + Math.sin(now / 1000 * f.freq + f.phase) * f.amp
          + windOffset * (0.35 + 0.65 * f.z);

        // 水平方向循环出入屏，避免飘出后消失
        const margin = 60;
        if (x > w + margin) {
          f.x0 -= (w + margin * 2);
          x -= (w + margin * 2);
        } else if (x < -margin) {
          f.x0 += (w + margin * 2);
          x += (w + margin * 2);
        }

        // 出屏底部重生
        if (f.y - f.size > h + 20) {
          f.y = -20 - Math.random() * 100;
          f.x0 = Math.random() * w;
          f.phase = Math.random() * Math.PI * 2;
        }

        // 更粗：描边 + 多次微偏移填充 + 发光
        const alpha = 0.45 + f.z * 0.5;
        const strokeAlpha = Math.min(1, 0.8 + f.z * 0.3);
        const glow = 2 + f.z * 8;
        const bold = 1.1 + f.z * 2.0; // 线宽随近景增大
        const bloat = 0.25 + 0.35 * f.z; // 轻微膨胀偏移

        ctx.save();
        ctx.translate(x, f.y);
        ctx.rotate(now / 1000 * f.spin);
        ctx.font = `700 ${f.size}px Arial, "Helvetica Neue", Helvetica, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineJoin = 'round';
        ctx.shadowColor = 'rgba(255,255,255,0.85)';
        ctx.shadowBlur = glow;

        // 描边
        ctx.strokeStyle = `rgba(255,255,255,${strokeAlpha})`;
        ctx.lineWidth = bold;
        ctx.strokeText(f.glyph, 0, 0);

        // 多次轻偏移填充，增加“粗度”
        ctx.fillStyle = `rgba(255,255,255,${alpha})`;
        ctx.fillText(f.glyph, 0, 0);
        ctx.fillText(f.glyph, bloat, 0);
        ctx.fillText(f.glyph, -bloat, 0);
        ctx.fillText(f.glyph, 0, bloat);
        ctx.fillText(f.glyph, 0, -bloat);

        ctx.restore();
      }

      raf = requestAnimationFrame(draw);
    };

    const onResize = () => {
      resize();
      ensureCount();
    };

    // 初始化
    resize();
    ensureCount();
    scheduleWind();

    if (!prefersReduce) {
      last = performance.now();
      raf = requestAnimationFrame(draw);
    }

    const ro = new ResizeObserver(onResize);
    ro.observe(canvas);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [density]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        display: 'block',
        pointerEvents: 'none',
        zIndex: 1
      }}
    />
  );
}
