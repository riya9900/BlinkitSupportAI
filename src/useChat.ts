// Holds the conversation and talks to the backend. Components just call
// send() / retry() / reset() and render `messages`.
import { useCallback, useEffect, useRef, useState } from 'react';
import { ChatApiError, sendChat } from './api';
import { MAX_USER_TEXT, buildHistory, friendlyError, type UiMessage } from './chatLogic';

export function useChat() {
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [sending, setSending] = useState(false);

  // Refs hold the latest values for callbacks that outlive a render.
  const messagesRef = useRef<UiMessage[]>([]);
  const sendingRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const generationRef = useRef(0); // bumped by reset() so late replies are ignored
  const nextId = useRef(1);

  const commit = useCallback((next: UiMessage[]) => {
    messagesRef.current = next;
    setMessages(next);
  }, []);

  const run = useCallback(
    async (conversation: UiMessage[]) => {
      const history = buildHistory(conversation);
      if (history.length === 0) return;

      const generation = generationRef.current;
      const controller = new AbortController();
      abortRef.current = controller;
      sendingRef.current = true;
      setSending(true);

      try {
        const result = await sendChat(history, controller.signal);
        if (generation !== generationRef.current) return;
        commit([
          ...messagesRef.current,
          { id: nextId.current++, role: 'assistant', text: result.reply, tools: result.toolCalls },
        ]);
      } catch (err) {
        if (generation !== generationRef.current || controller.signal.aborted) return;
        const known =
          err instanceof ChatApiError ? { text: err.message, retryable: err.retryable } : friendlyError(500);
        commit([
          ...messagesRef.current,
          { id: nextId.current++, role: 'error', text: known.text, retryable: known.retryable },
        ]);
      } finally {
        if (generation === generationRef.current) {
          sendingRef.current = false;
          setSending(false);
        }
      }
    },
    [commit],
  );

  const send = useCallback(
    (text: string) => {
      const clean = text.trim();
      if (!clean || clean.length > MAX_USER_TEXT || sendingRef.current) return;
      const next: UiMessage[] = [...messagesRef.current, { id: nextId.current++, role: 'user', text: clean }];
      commit(next);
      void run(next);
    },
    [commit, run],
  );

  // Re-sends the conversation after an error, without duplicating the customer's message.
  const retry = useCallback(() => {
    if (sendingRef.current) return;
    const last = messagesRef.current[messagesRef.current.length - 1];
    if (last?.role !== 'error') return;
    const withoutError = messagesRef.current.slice(0, -1);
    commit(withoutError);
    void run(withoutError);
  }, [commit, run]);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    generationRef.current += 1;
    sendingRef.current = false;
    setSending(false);
    commit([]);
  }, [commit]);

  // Cancel any request still in flight when the page is closed.
  useEffect(() => () => abortRef.current?.abort(), []);

  return { messages, sending, send, retry, reset };
}
