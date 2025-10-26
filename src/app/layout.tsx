import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Dchat - 聊天应用",
  description: "一个现代化的聊天应用",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>
        {children}
      </body>
    </html>
  );
}
