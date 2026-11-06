import { SUGGESTION_CARDS, type SuggestionCard } from '../chatLogic';

interface Props {
  onSelectPrompt: (prompt: string) => void;
  disabled: boolean;
}

export function WelcomeScreen({ onSelectPrompt, disabled }: Props) {
  function renderCardIcon(type: SuggestionCard['icon']) {
    switch (type) {
      case 'track':
        return (
          <svg className="card-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="1" y="3" width="15" height="13" rx="2" />
            <polygon points="16 8 20 8 23 11 23 16 16 16 16 8" />
            <circle cx="5.5" cy="18.5" r="2.5" />
            <circle cx="18.5" cy="18.5" r="2.5" />
          </svg>
        );
      case 'refund':
        return (
          <svg className="card-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            <path d="M9 12l2 2 4-4" />
          </svg>
        );
      case 'product':
        return (
          <svg className="card-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
            <line x1="3" y1="6" x2="21" y2="6" />
            <path d="M16 10a4 4 0 0 1-8 0" />
          </svg>
        );
      case 'support':
        return (
          <svg className="card-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            <path d="M12 7v2" />
            <path d="M12 13h.01" />
          </svg>
        );
    }
  }

  return (
    <section className="welcome-hero" aria-label="Welcome and quick options">
      <div className="welcome-header">
        <div className="welcome-pill">
          <span className="welcome-pill-bolt">⚡</span>
          <span>Blinkit 10-Minute Support AI</span>
        </div>
        <h2 className="welcome-title">How can we help you today?</h2>
        <p className="welcome-subtitle">Your shopping support, made simple.</p>
      </div>

      <div className="cards-grid" role="group" aria-label="Quick assistance suggestions">
        {SUGGESTION_CARDS.map((card) => (
          <button
            key={card.id}
            type="button"
            className="suggestion-card"
            onClick={() => onSelectPrompt(card.prompt)}
            disabled={disabled}
          >
            <div className="card-icon-wrapper" data-type={card.icon}>
              {renderCardIcon(card.icon)}
            </div>
            <div className="card-text-group">
              <div className="card-title-row">
                <span className="card-title">{card.title}</span>
                {card.tag && <span className="card-tag">{card.tag}</span>}
              </div>
              <p className="card-desc">{card.subtitle}</p>
            </div>
            <div className="card-arrow" aria-hidden="true">
              <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16">
                <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
              </svg>
            </div>
          </button>
        ))}
      </div>

      <div className="trust-features-bar">
        <div className="trust-item">
          <span className="trust-dot">✓</span>
          <span>Live Order Tracking</span>
        </div>
        <div className="trust-item">
          <span className="trust-dot">✓</span>
          <span>Instant Refunds (&lt;₹200)</span>
        </div>
        <div className="trust-item">
          <span className="trust-dot">✓</span>
          <span>Live Catalog Check</span>
        </div>
        <div className="trust-item">
          <span className="trust-dot">✓</span>
          <span>Human Agent Transfer</span>
        </div>
      </div>
    </section>
  );
}

