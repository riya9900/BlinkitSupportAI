interface HeaderProps {
  onNewChat: () => void;
  canReset: boolean;
}

export function Header({ onNewChat, canReset }: HeaderProps) {
  return (
    <header className="brand-header">
      <div className="header-brand-group">
        <div className="blinkit-logo-badge" aria-hidden="true">
          <span className="logo-letter">b</span>
          <span className="logo-bolt">⚡</span>
        </div>
        <div className="brand-identity">
          <div className="brand-title-row">
            <span className="brand-name">blinkit</span>
            <span className="support-badge">SUPPORT</span>
          </div>
          <div className="status-indicator-row">
            <span className="status-pulse-dot" aria-hidden="true" />
            <span className="status-text">Online · We're here to help</span>
          </div>
        </div>
      </div>

      <div className="header-actions">
        <button
          type="button"
          className="new-chat-btn"
          onClick={onNewChat}
          disabled={!canReset}
          title="Start a new conversation"
          aria-label="Start a new conversation"
        >
          <svg className="action-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          <span className="btn-label">New Chat</span>
        </button>
      </div>
    </header>
  );
}

