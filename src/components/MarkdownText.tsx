import React, { type ReactNode } from 'react';

interface Props {
  text: string;
}

// Parses inline Markdown elements (bold, italic, code, links) into React elements.
function parseInline(text: string): ReactNode[] {
  const elements: ReactNode[] = [];
  // Matches: **bold**, __bold__, `code`, *italic*, _italic_, [link](url)
  const regex = /(\*\*.*?\*\*|__.*?__|`.*?`|(?<!\*)\*[^*]+?\*(?!\*)|(?<!_)_[^_]+?_(?!_)|\[.*?\]\(.*?\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      elements.push(text.slice(lastIndex, match.index));
    }

    const token = match[0];
    const key = `${match.index}-${token.slice(0, 5)}`;

    if ((token.startsWith('**') && token.endsWith('**')) || (token.startsWith('__') && token.endsWith('__'))) {
      const inner = token.slice(2, -2);
      elements.push(<strong key={key} className="md-bold">{parseInline(inner)}</strong>);
    } else if (token.startsWith('`') && token.endsWith('`')) {
      const inner = token.slice(1, -1);
      elements.push(<code key={key} className="md-code">{inner}</code>);
    } else if ((token.startsWith('*') && token.endsWith('*')) || (token.startsWith('_') && token.endsWith('_'))) {
      const inner = token.slice(1, -1);
      elements.push(<em key={key} className="md-italic">{parseInline(inner)}</em>);
    } else if (token.startsWith('[') && token.includes('](') && token.endsWith(')')) {
      const closeBracket = token.indexOf('](');
      const label = token.slice(1, closeBracket);
      const url = token.slice(closeBracket + 2, -1);
      elements.push(
        <a key={key} href={url} target="_blank" rel="noopener noreferrer" className="md-link">
          {label}
        </a>,
      );
    } else {
      elements.push(token);
    }

    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    elements.push(text.slice(lastIndex));
  }

  return elements;
}

export function MarkdownText({ text }: Props) {
  if (!text) return null;

  // Split into paragraphs / blocks by double newlines
  const rawBlocks = text.split(/\n{2,}/);

  return (
    <div className="md-content">
      {rawBlocks.map((block, blockIndex) => {
        const trimmed = block.trim();
        if (!trimmed) return null;

        const lines = trimmed.split('\n');

        // Check if block is a heading
        if (lines.length === 1 && /^#{1,4}\s+/.test(trimmed)) {
          const level = (trimmed.match(/^#+/) ?? ['#'])[0].length;
          const content = trimmed.replace(/^#+\s+/, '');
          if (level === 1) return <h3 key={blockIndex} className="md-h1">{parseInline(content)}</h3>;
          if (level === 2) return <h4 key={blockIndex} className="md-h2">{parseInline(content)}</h4>;
          return <h5 key={blockIndex} className="md-h3">{parseInline(content)}</h5>;
        }

        // Check if block is an unordered list
        const isBulletList = lines.every((line) => /^[-*•]\s+/.test(line.trim()));
        if (isBulletList) {
          return (
            <ul key={blockIndex} className="md-ul">
              {lines.map((line, lineIdx) => {
                const itemText = line.trim().replace(/^[-*•]\s+/, '');
                return <li key={lineIdx} className="md-li">{parseInline(itemText)}</li>;
              })}
            </ul>
          );
        }

        // Check if block is an ordered list
        const isNumberedList = lines.every((line) => /^\d+\.\s+/.test(line.trim()));
        if (isNumberedList) {
          return (
            <ol key={blockIndex} className="md-ol">
              {lines.map((line, lineIdx) => {
                const itemText = line.trim().replace(/^\d+\.\s+/, '');
                return <li key={lineIdx} className="md-li">{parseInline(itemText)}</li>;
              })}
            </ol>
          );
        }

        // Check if block is a blockquote
        if (lines.every((line) => line.trim().startsWith('>'))) {
          const quoteText = lines.map((l) => l.trim().replace(/^>\s*/, '')).join(' ');
          return (
            <blockquote key={blockIndex} className="md-quote">
              {parseInline(quoteText)}
            </blockquote>
          );
        }

        // Standard paragraph with line breaks
        return (
          <p key={blockIndex} className="md-p">
            {lines.map((line, lineIdx) => (
              <React.Fragment key={lineIdx}>
                {parseInline(line)}
                {lineIdx < lines.length - 1 && <br />}
              </React.Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}

