import type { Metadata, Viewport } from 'next';
import './globals.css';

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export const metadata: Metadata = {
  title: '可乐的小站',
  description: 'AI 智能助手聊天',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" className="light">
      <body style={{ colorScheme: 'light' }}>
        {children}
      </body>
    </html>
  );
}
