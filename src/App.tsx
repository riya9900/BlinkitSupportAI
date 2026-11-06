import { useEffect, useRef } from 'react';
import './App.css';
import { Composer } from './components/Composer';
import { Header } from './components/Header';
import { MessageBubble } from './components/MessageBubble';
import { WelcomeScreen } from './components/WelcomeScreen';
import { useChat } from './useChat';

export default function App() {
  const { messages, sending, send, retry, reset } = useChat();
  const endRef = useRef<HTMLDivElement>(null);

  // Keep the newest message in view smoothly
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, sending]);

  const lastId = messages[messages.length - 1]?.id;

  return (
    <div className="blinkit-app">
      <Header onNewChat={reset} canReset={messages.length > 0} />

      <main className="chat-viewport" role="log" aria-live="polite" aria-label="Support conversation">
        <div className="chat-content-container">
          {messages.length === 0 ? (
            <WelcomeScreen onSelectPrompt={send} disabled={sending} />
          ) : (
            <div className="messages-stream">
              {messages.map((m) => (
                <MessageBubble
                  key={m.id}
                  message={m}
                  canRetry={m.id === lastId && !sending}
                  onRetry={retry}
                />
              ))}

              {sending && (
                <div className="message-row row-assistant message-animate" role="status">
                  <div className="avatar-col" aria-hidden="true">
                    <div className="assistant-avatar avatar-pulse">
                      <span className="avatar-text">b</span>
                      <span className="avatar-bolt">⚡</span>
                    </div>
                  </div>
                  <div className="bubble-wrapper">
                    <div className="assistant-sender-label">
                      <span>Blinkit Support</span>
                      <span className="sender-pill">AI</span>
                    </div>
                    <div className="bubble bubble-assistant typing-bubble">
                      <div className="typing-dots">
                        <span className="typing-dot" />
                        <span className="typing-dot" />
                        <span className="typing-dot" />
                      </div>
                      <span className="typing-label">Checking your request...</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
          <div ref={endRef} />
        </div>
      </main>

      <Composer disabled={sending} onSend={send} />
    </div>
  );
}
