// 共享类型定义
export type ContentItem = {
  type: string;
  text?: string;
  image_url?: { url: string };
};

export type Message = {
  id: string;
  role: 'user' | 'ai';
  content: string | ContentItem[];
  timestamp: number;
};

export type WinterEmoji = {
  id: string;
  x: number;
  y: number;
  emoji: string;
  anim: number;
};

export type UploadedFile = {
  name: string;
  type: string;
  data: string; // URL after upload, or base64
};

export type APIMessage = {
  role: 'user' | 'assistant';
  content: string | ContentItem[];
};

// 工具函数
export const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

// 触发词检测
export const isTarotTriggerText = (txt: string) => /^\s*(占卜|塔罗|塔羅)\s*$/i.test(txt);
