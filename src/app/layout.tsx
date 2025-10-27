import type { Metadata } from 'next';
import './globals.css';
import { Noto_Sans_SC } from 'next/font/google';

const noto = Noto_Sans_SC({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
});

export const metadata: Metadata = {
  title: '可乐的小站',
  description: 'AI 智能助手聊天',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className={noto.className}>{children}</body>
    </html>
  );
}
