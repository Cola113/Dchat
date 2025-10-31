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

const GLYPHS = ['❄','❅','❆','✻','✼','❉','*','·','•'];

export default function SnowFX({ density = 1 }: { density?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const prefersReduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    let raf = 0;
    let wind = 0;          // 当前风速（影响水平位移）
    let windTarget = 0;    // 目标风速，缓动过去，形成“风阵”
    let last = performance.now();

    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1)); // 限 2 省电
    const resize = () => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
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
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      // 基于面积自适应数量；density=1 在 390x844 约 120~150 片
      const target = Math.round((w * h) / 22000 * density);
      while (flakes.length < target) flakes.push(makeFlake(w, h));
      if (flakes.length > target) flakes.length = target;
    };

    const scheduleWind = () => {
      // 每 6~12 秒改变一次风向与强度
      windTarget = (-30 + Math.random() * 60); // -30~30 px/s
      setTimeout(scheduleWind, 6000 + Math.random() * 6000);
    };

    const draw = (now: number) => {
      const dt = Math.min(0.033, (now - last) / 1000); // 限最大步长，避免切后台卡帧
      last = now;

      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      ctx.clearRect(0, 0, w, h);

      // 轻柔合成，更亮一些
      ctx.globalCompositeOperation = 'lighter';

      // 缓动风速
      wind += (windTarget - wind) * Math.min(1, dt * 0.6);

      // 画三层：远->近，近景更亮更模糊
      flakes.sort((a, b) => a.z - b.z);
      for (const f of flakes) {
        f.y += f.vy * dt;
        // 左右摆动 + 风
        const x = f.x0 + Math.sin(now / 1000 * f.freq + f.phase) * f.amp + wind * f.z;

        // 出屏重置
        if (f.y - f.size > h + 20) {
          // 重生在上方
          f.y = -20 - Math.random() * 100;
          f.x0 = Math.random() * w;
          f.phase = Math.random() * Math.PI * 2;
        }

        // 视觉（亮度/模糊/透明度随深度）
        const alpha = 0.35 + f.z * 0.6;
        ctx.save();
        ctx.translate(x, f.y);
        ctx.rotate(now / 1000 * f.spin);
        ctx.font = `${f.size}px Arial, "Helvetica Neue", Helvetica, sans-serif`;
        ctx.fillStyle = `rgba(255,255,255,${alpha})`;
        ctx.shadowColor = 'rgba(255,255,255,0.6)';
        ctx.shadowBlur = 2 + f.z * 6;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(f.glyph, 0, 0);
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

    // 监听
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
      className="snow-canvas"
      aria-hidden="true"
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 1
      }}
    />
  );
}
