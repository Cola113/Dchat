'use client';

import { useRef, useCallback } from 'react';
import Image from 'next/image';
import type { UploadedFile } from './types';

type ChatInputProps = {
  inputValue: string;
  uploadedFiles: UploadedFile[];
  isGenerating: boolean;
  onInputChange: (value: string) => void;
  onSend: (text?: string) => void;
  onFileUpload: (files: FileList) => void;
  onRemoveFile: (index: number) => void;
};

export function ChatInput({
  inputValue,
  uploadedFiles,
  isGenerating,
  onInputChange,
  onSend,
  onFileUpload,
  onRemoveFile,
}: ChatInputProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // 文本域自适应高度
  const autoResize = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const max = 120;
    el.style.height = Math.min(el.scrollHeight, max) + 'px';
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  }, [onSend]);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      onFileUpload(e.target.files);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [onFileUpload]);

  return (
    <div className="input-area">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        onChange={handleFileChange}
        style={{ display: 'none' }}
      />

      <button
        className="upload-button"
        onClick={() => fileInputRef.current?.click()}
        title="上传图片"
        aria-label="上传图片"
      >
        🖼️
      </button>

      <div className="input-wrapper">
        {uploadedFiles.length > 0 && (
          <div className="uploaded-files">
            {uploadedFiles.map((file, index) => (
              <div key={index} className="file-preview">
                <Image
                  src={file.data}
                  alt={file.name}
                  width={80}
                  height={80}
                />
                <button
                  className="remove-file"
                  onClick={() => onRemoveFile(index)}
                  aria-label="删除图片"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        <textarea
          ref={inputRef}
          className="input-box resize-none"
          placeholder="输入你的消息...🎄"
          value={inputValue}
          onChange={(e) => { onInputChange(e.target.value); autoResize(); }}
          onKeyDown={handleKeyDown}
          rows={1}
        />
      </div>

      <button
        className="send-button"
        onClick={() => onSend()}
        disabled={!inputValue.trim() && uploadedFiles.length === 0 && !isGenerating}
        aria-label={isGenerating ? '暂停生成' : '发送消息'}
        title={isGenerating ? '暂停生成' : '发送'}
      >
        {isGenerating ? '⏸' : '发送'}
      </button>
    </div>
  );
}
