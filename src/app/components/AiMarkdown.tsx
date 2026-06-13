'use client';

import type { ComponentProps } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';

type AiMarkdownProps = {
  content: string;
};

const markdownComponents = {
  strong: (props: ComponentProps<'strong'>) => (
    <strong style={{ fontWeight: '700', color: 'inherit' }} {...props} />
  ),
  em: (props: ComponentProps<'em'>) => (
    <em style={{ fontStyle: 'italic' }} {...props} />
  ),
};

export default function AiMarkdown({ content }: AiMarkdownProps) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeKatex]}
      components={markdownComponents}
    >
      {content}
    </ReactMarkdown>
  );
}
