import { useState } from 'react';
import { toolLabel, type UiMessage } from '../chatLogic';
import { MarkdownText } from './MarkdownText';

interface Props {
  message: UiMessage;
  canRetry: boolean;
  onRetry: () => void;
}

export function MessageBubble({ message, canRetry, onRetry }: Props) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    if (!message.text) return;
    navigator.clipboard.writeText(message.text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  if (message.role === 'error') {
    return (
      <div className="message-row row-assistant message-animate">
        <div className="avatar-col" aria-hidden="true">
          <div className="assistant-avatar avatar-error">
            <span>!</span>
          </div>
        </div>
        <div className="bubble-wrapper">
          <div className="bubble bubble-error" role="alert">
            <div className="error-header">
              <svg className="error-icon" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
              <span className="error-title">Request notice</span>
            </div>
            <p className="error-message">{message.text}</p>
            {message.retryable && canRetry && (
              <button type="button" className="retry-btn" onClick={onRetry}>
                <svg className="btn-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                <span>Try again</span>
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  const isUser = message.role === 'user';

  if (isUser) {
    return (
      <div className="message-row row-user message-animate">
        <div className="bubble-wrapper">
          <div className="bubble bubble-user">
            <span className="visually-hidden">You said: </span>
            <p className="user-text">{message.text}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="message-row row-assistant message-animate">
      <div className="avatar-col" aria-hidden="true">
        <div className="assistant-avatar">
          <span className="avatar-text">b</span>
          <span className="avatar-bolt">⚡</span>
        </div>
      </div>

      <div className="bubble-wrapper">
        <div className="assistant-sender-label">
          <span>Blinkit Support</span>
          <span className="sender-pill">AI</span>
        </div>

        <div className="bubble bubble-assistant">
          <span className="visually-hidden">Assistant said: </span>
          <MarkdownText text={message.text} />

          {message.tools && message.tools.length > 0 && (
            <div className="tool-execution-tray" aria-label="Actions completed by support assistant">
              <div className="tool-tray-title">Support actions verified:</div>
              <div className="tool-chips-row">
                {message.tools.map((tool, i) => (
                  <div
                    key={i}
                    className={`tool-chip ${tool.ok ? 'tool-chip-ok' : 'tool-chip-failed'}`}
                    title={tool.ok ? 'Completed successfully' : 'Failed to execute'}
                  >
                    <span className="tool-status-icon">
                      {tool.ok ? (
                        <svg viewBox="0 0 16 16" fill="currentColor" width="12" height="12">
                          <path d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z" />
                        </svg>
                      ) : (
                        <svg viewBox="0 0 16 16" fill="currentColor" width="12" height="12">
                          <path d="M3.72 3.72a.75.75 0 011.06 0L8 6.94l3.22-3.22a.75.75 0 111.06 1.06L9.06 8l3.22 3.22a.75.75 0 11-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 01-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 010-1.06z" />
                        </svg>
                      )}
                    </span>
                    <span className="tool-name">{toolLabel(tool.name)}</span>
                    {!tool.ok && <span className="tool-failed-note">(failed)</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="bubble-actions">
            <button
              type="button"
              className="copy-btn"
              onClick={handleCopy}
              title="Copy answer to clipboard"
            >
              {copied ? (
                <>
                  <svg viewBox="0 0 16 16" fill="currentColor" width="12" height="12">
                    <path d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z" />
                  </svg>
                  <span>Copied</span>
                </>
              ) : (
                <>
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" width="12" height="12">
                    <rect x="5" y="5" width="8" height="8" rx="1.5" />
                    <path d="M3 11V3.5A1.5 1.5 0 014.5 2H11" />
                  </svg>
                  <span>Copy</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
