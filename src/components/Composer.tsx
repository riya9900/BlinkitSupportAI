import { useState, useRef, useEffect, type FormEvent, type KeyboardEvent } from 'react';
import { MAX_USER_TEXT } from '../chatLogic';

interface Props {
  disabled: boolean; // true while waiting for a reply
  onSend: (text: string) => void;
}

export function Composer({ disabled, onSend }: Props) {
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const trimmed = text.trim();
  const canSend = !disabled && trimmed.length > 0;

  // Auto-resize textarea as user types
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [text]);

  function submit() {
    if (!canSend) return;
    onSend(trimmed);
    setText('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.focus();
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    submit();
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  }

  const charCount = text.length;
  const isNearLimit = charCount >= MAX_USER_TEXT * 0.85;
  const isAtLimit = charCount >= MAX_USER_TEXT;

  return (
    <footer className="composer-wrapper">
      <div className="composer-container">
        <form className="composer-form" onSubmit={handleSubmit}>
          <div className="input-row">
            <textarea
              ref={textareaRef}
              id="chat-input"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={handleKeyDown}
              maxLength={MAX_USER_TEXT}
              rows={1}
              placeholder="Ask me about your order, refunds or products..."
              aria-label="Ask Blinkit Support"
              disabled={disabled}
            />

            <button
              type="submit"
              className="send-action-btn"
              disabled={!canSend}
              title={disabled ? 'Waiting for response...' : 'Send message (Enter)'}
              aria-label="Send message"
            >
              {disabled ? (
                <span className="spinner-icon" aria-hidden="true" />
              ) : (
                <svg className="send-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              )}
            </button>
          </div>

          <div className="composer-meta-bar">
            <div className="keyboard-hints">
              <span className="key-badge">Enter ↵</span>
              <span className="hint-label">to send</span>
              <span className="hint-separator">·</span>
              <span className="key-badge">Shift + Enter</span>
              <span className="hint-label">for new line</span>
            </div>

            <div className={`char-counter ${isAtLimit ? 'counter-danger' : isNearLimit ? 'counter-warning' : ''}`}>
              {charCount > 0 ? `${charCount} / ${MAX_USER_TEXT}` : `${MAX_USER_TEXT} max`}
            </div>
          </div>
        </form>
      </div>
    </footer>
  );
}
