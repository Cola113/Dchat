'use client';

import { useState, useRef, useEffect } from 'react';
import Image from 'next/image';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';

type Message = {
  id: string;
  role: 'user' | 'ai';
  content: string | Array<{type: string; text?: string; image_url?: {url: string}}>;
  timestamp: number;
};

type WinterEmoji = { id: string; x: number; y: number; emoji: string; anim: number };

const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

function Snowflakes() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  const snowflakeSymbols = ['❄', '❅', '❆', '✻', '✼', '❉', '✺', '✹', '✸', '✷', '✶', '✵', '✴', '✳', '✲', '✱', '*', '·', '•'];

  return (
    <div className="snowflakes">
      {Array.from({ length: 300 }).map((_, i) => {
        const symbol = snowflakeSymbols[i % snowflakeSymbols.length];
        const randomOpacity = (0.2 + Math.random() * 0.7).toFixed(2);
        
        return (
          <div 
            key={i} 
            className="snowflake"
            style={{ 
              '--snowflake-opacity': randomOpacity,
              opacity: randomOpacity 
            } as React.CSSProperties}
          >
            {symbol}
          </div>
        );
      })}
    </div>
  );
}

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: uid(),
      role: 'ai',
      content: '你好!我是可乐的AI助手~ 🎄\n\n在这个圣诞季节,有什么可以帮助你的吗?',
      timestamp: Date.now()
    }
  ]);
  const [inputValue, setInputValue] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [winterEmojis, setWinterEmojis] = useState<WinterEmoji[]>([]);
  const [uploadedFiles, setUploadedFiles] = useState<Array<{name: string; url: string}>>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatMessagesRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = () => {
    if (chatMessagesRef.current) {
      chatMessagesRef.current.scrollTop = chatMessagesRef.current.scrollHeight;
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleEmojiClick = () => {
    const winterEmojiList = [
      '❄️', '⛄', '☃️', '🌨️', '🏔️', '🧊', '❄',
      '🎄', '🎅', '🤶', '🎁', '🎀', '🔔', '🕯️', '⭐', '🌟', '✨', '🦌', '🛷', '🧦', '🎊', '🎉',
      '🍪', '🥛', '☕', '🍵', '🫖', '🍫', '🥧', '🧁',
      '🧤', '🧣', '🎩', '👢',
      '🐧', '🦭', '🐻‍❄️',
      '💫', '🌠', '💎', '🪄'
    ];
    
    const randomEmoji = winterEmojiList[Math.floor(Math.random() * winterEmojiList.length)];
    const randomAnim = Math.floor(Math.random() * 5) + 1;
    
    const newEmoji: WinterEmoji = {
      id: uid(),
      x: Math.random() * window.innerWidth,
      y: Math.random() * window.innerHeight,
      emoji: randomEmoji,
      anim: randomAnim,
    };

    setWinterEmojis((prev) => [...prev, newEmoji]);

    setTimeout(() => {
      setWinterEmojis((prev) => prev.filter((item) => item.id !== newEmoji.id));
    }, 2500);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsUploading(true);

    try {
      const uploadPromises = Array.from(files).map(async (file) => {
        const formData = new FormData();
        formData.append('file', file);

        const response = await fetch('/api/upload', {
          method: 'POST',
          body: formData,
        });

        if (!response.ok) {
          throw new Error('上传失败');
        }

        const data = await response.json();
        return { name: file.name, url: data.url };
      });

      const uploaded = await Promise.all(uploadPromises);
      setUploadedFiles(prev => [...prev, ...uploaded]);
    } catch (error) {
      console.error('上传错误:', error);
      alert('上传失败，请重试');
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const removeFile = (index: number) => {
    setUploadedFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setIsGenerating(false);
    }
  };

  const handleSend = async () => {
    if (!inputValue.trim() && uploadedFiles.length === 0) return;

    if (isGenerating) {
      handleStop();
      return;
    }

    let userContent: string | Array<{type: string; text?: string; image_url?: {url: string}}>;

    if (uploadedFiles.length > 0) {
      userContent = [
        { type: 'text', text: inputValue.trim() || '请分析这些图片' },
        ...uploadedFiles.map(file => ({
          type: 'image_url',
          image_url: { url: file.url }
        }))
      ];
    } else {
      userContent = inputValue.trim();
    }

    const userMessage: Message = {
      id: uid(),
      role: 'user',
      content: userContent,
      timestamp: Date.now()
    };

    setMessages(prev => [...prev, userMessage]);
    setInputValue('');
    setUploadedFiles([]);
    setIsGenerating(true);

    const aiMessageId = uid();
    const hasImages = uploadedFiles.length > 0;

    if (hasImages) {
      const loadingMessage: Message = {
        id: aiMessageId,
        role: 'ai',
        content: '🔍 正在识别图片，请稍候...',
        timestamp: Date.now()
      };
      setMessages(prev => [...prev, loadingMessage]);
    }

    try {
      const apiMessages = messages.map(msg => ({
        role: msg.role === 'ai' ? 'assistant' : 'user',
        content: msg.content
      })).concat({
        role: 'user',
        content: userContent
      });

      abortControllerRef.current = new AbortController();

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages: apiMessages
        }),
        signal: abortControllerRef.current.signal
      });

      if (!response.ok) {
        throw new Error('请求失败');
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) {
        throw new Error('无法读取响应流');
      }

      let fullContent = '';
      let hasStarted = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();
            
            if (data === '[DONE]') {
              break;
            }

            try {
              const parsed = JSON.parse(data);
              const content = parsed.choices?.[0]?.delta?.content || '';
              
              if (content) {
                if (!hasStarted) {
                  if (hasImages) {
                    setMessages(prev => 
                      prev.map(msg => 
                        msg.id === aiMessageId 
                          ? { ...msg, content: content }
                          : msg
                      )
                    );
                  } else {
                    const aiMessage: Message = {
                      id: aiMessageId,
                      role: 'ai',
                      content: content,
                      timestamp: Date.now()
                    };
                    setMessages(prev => [...prev, aiMessage]);
                  }
                  hasStarted = true;
                }
                
                fullContent += content;
                
                setMessages(prev => 
                  prev.map(msg => 
                    msg.id === aiMessageId 
                      ? { ...msg, content: fullContent }
                      : msg
                  )
                );
              }
            } catch {
              // 跳过无法解析的行
            }
          }
        }
      }

      if (!fullContent) {
        setMessages(prev => 
          prev.map(msg => 
            msg.id === aiMessageId 
              ? { ...msg, content: '抱歉，我无法生成回复。' }
              : msg
          )
        );
      }

    } catch (error: any) {
      if (error.name === 'AbortError') {
        console.log('生成已停止');
      } else {
        console.error('请求错误:', error);
        setMessages(prev => 
          prev.map(msg => 
            msg.id === aiMessageId 
              ? { ...msg, content: '抱歉，连接服务器失败，请稍后再试。' }
              : msg
          )
        );
      }
    } finally {
      setIsGenerating(false);
      abortControllerRef.current = null;
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const renderMessageContent = (content: string | Array<{type: string; text?: string; image_url?: {url: string}}>) => {
    if (typeof content === 'string') {
      return content;
    }
    
    return (
      <div>
        {content.map((item, index) => {
          if (item.type === 'text') {
            return <div key={index}>{item.text}</div>;
          }
          if (item.type === 'image_url' && item.image_url) {
            return (
              <div key={index} className="uploaded-image-container">
                <Image
                  src={item.image_url.url}
                  alt="上传的图片"
                  width={200}
                  height={150}
                  className="uploaded-image"
                />
              </div>
            );
          }
          return null;
        })}
      </div>
    );
  };

  return (
    <main 
      className="relative min-h-[100dvh] overflow-hidden"
      onClick={handleEmojiClick}
    >
      <div className="absolute inset-0 -z-30 bg-gradient-to-b from-sky-400 via-green-200/60 via-30% via-red-200/50 via-60% to-white" />
      <div className="pointer-events-none absolute -top-40 left-1/4 -z-10 h-[500px] w-[500px] rounded-full bg-blue-400/20 blur-3xl" />
      <div className="pointer-events-none absolute top-1/3 right-1/4 -z-10 h-[400px] w-[400px] rounded-full bg-green-300/15 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-20 left-1/2 -translate-x-1/2 -z-10 h-[400px] w-[400px] rounded-full bg-pink-200/10 blur-3xl" />

      <Snowflakes />

      {winterEmojis.map((item) => (
        <div
          key={item.id}
          className={`winter-emoji winter-emoji-anim-${item.anim}`}
          style={{ left: item.x - 16, top: item.y - 16 }}
        >
          {item.emoji}
        </div>
      ))}

      <div className="chat-container">
        <div className="header">
          <div style={{ display: 'inline-block' }}>
            <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-red-600 via-green-600 to-red-600 shimmer" style={{ letterSpacing: '-0.02em' }}>
              可乐的小站
            </h1>
          </div>
          <p className="mt-2 text-red-700/90 text-base glow">
            <span className="emoji-bounce">🎄</span>顶<span className="emoji-bounce">🎅</span>级<span className="emoji-bounce">⛄</span>牛<span className="emoji-bounce">🎁</span>马<span className="emoji-bounce">🔔</span>
          </p>
        </div>

        <div 
          ref={chatMessagesRef}
          className="chat-messages"
        >
          {messages.map((message) => (
            <div key={message.id} className={`message ${message.role}`}>
              <div className="avatar">
                {message.role === 'ai' ? (
                  <Image
                    src="/robot-santa.png"
                    alt="AI助手"
                    width={40}
                    height={40}
                    className="avatar-img"
                  />
                ) : (
                  '🎅'
                )}
              </div>
              <div className="bubble">
                {message.role === 'ai' && typeof message.content === 'string' ? (
                  <ReactMarkdown 
                    remarkPlugins={[remarkGfm, remarkMath]}
                    rehypePlugins={[rehypeKatex]}
                    components={{
                      code: ({children}: {children?: React.ReactNode}) => (
                        <code className="inline-code">
                          {children}
                        </code>
                      )
                    }}
                  >
                    {message.content}
                  </ReactMarkdown>
                ) : (
                  renderMessageContent(message.content)
                )}
              </div>
            </div>
          ))}
          
          <div ref={messagesEndRef} />
        </div>

        <div className="input-area">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={handleFileUpload}
            style={{ display: 'none' }}
            disabled={isUploading}
          />
          
          <button 
            className="upload-button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
            title="上传图片"
          >
            {isUploading ? '...' : '上传'}
          </button>

          <div className="input-wrapper">
            {uploadedFiles.length > 0 && (
              <div className="uploaded-files">
                {uploadedFiles.map((file, index) => (
                  <div key={index} className="file-preview">
                    <Image
                      src={file.url}
                      alt={file.name}
                      width={80}
                      height={80}
                    />
                    <button 
                      className="remove-file"
                      onClick={() => removeFile(index)}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
            
            <textarea
              className="input-box resize-none"
              placeholder="输入你的消息...🎄"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyPress={handleKeyPress}
              rows={1}
              style={{ maxHeight: '120px' }}
            />
          </div>

          <button 
            className="send-button"
            onClick={handleSend}
            disabled={!inputValue.trim() && uploadedFiles.length === 0 && !isGenerating}
          >
            {isGenerating ? '⏸' : '发送'}
          </button>
        </div>
      </div>
    </main>
  );
}
