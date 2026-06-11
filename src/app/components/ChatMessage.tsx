'use client';

import { memo } from 'react';
import Image from 'next/image';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import type { ContentItem } from './types';

type ChatMessageProps = {
  id: string;
  role: 'user' | 'ai';
  content: string | ContentItem[];
  isOptionMessage: boolean;
  suggestedOptions: string[];
  onOptionClick: (option: string) => void;
};

function ChatMessageInner({ role, content, isOptionMessage, suggestedOptions, onOptionClick }: ChatMessageProps) {
  const renderContent = () => {
    if (typeof content === 'string') {
      return (
        <div>
          <ReactMarkdown
            remarkPlugins={[remarkGfm, remarkMath]}
            rehypePlugins={[rehypeKatex]}
            components={{
              strong: (props) => (
                <strong style={{ fontWeight: '700', color: 'inherit' }} {...props} />
              ),
              em: (props) => (
                <em style={{ fontStyle: 'italic' }} {...props} />
              ),
              // eslint-disable-next-line @next/next/no-img-element
              img: (props) => (
                <img
                  {...props}
                  alt={props.alt ?? ''}
                  style={{ maxWidth: '100%', height: 'auto', borderRadius: 8 }}
                />
              ),
            }}
          >
            {content}
          </ReactMarkdown>

          {isOptionMessage && suggestedOptions.length > 0 && (
            <div className="message-options">
              <div className="options-label">💡点击选择✨</div>
              <div className="options-buttons">
                {suggestedOptions.map((option, index) => (
                  <button
                    key={index}
                    className="option-button-in-message"
                    onClick={() => onOptionClick(option)}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      );
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
    <div className={`message ${role}`}>
      <div className="avatar">
        {role === 'ai' ? (
          <Image
            src="/robot-santa.png"
            alt="AI助手"
            width={40}
            height={40}
            className="avatar-img"
          />
        ) : (
          '🐮'
        )}
      </div>
      <div className="bubble">
        {renderContent()}
      </div>
    </div>
  );
}

export const ChatMessage = memo(ChatMessageInner);
ChatMessage.displayName = 'ChatMessage';
