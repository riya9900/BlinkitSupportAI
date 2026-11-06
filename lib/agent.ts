// The agent loop: ask the model; if it wants tools, run them, give the results
// back, and repeat until it answers in plain text. The model client and the tool
// executor are passed in, so this logic is testable without Gemini or a database.
import type { Content } from '@google/genai';
import type { ToolResult } from './agentTools.js';
import type { ChatMessage } from './validation.js';

export const MAX_TOOL_ROUNDS = 6; // model->tools->model cycles per customer message
export const MAX_CALLS_PER_ROUND = 4; // tool calls we will run from a single model turn

export interface ModelFunctionCall {
  id?: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ModelTurn {
  text: string;
  functionCalls: ModelFunctionCall[];
  content: Content; // the model's turn exactly as received; must be sent back as history
}

export type GenerateFn = (contents: Content[]) => Promise<ModelTurn>;
export type ToolExecutor = (name: string, args: Record<string, unknown>) => Promise<ToolResult>;

export interface AgentResult {
  reply: string;
  toolCalls: { name: string; ok: boolean }[];
}

export const FALLBACK_REPLY =
  "I'm sorry, I'm having trouble completing that right now. Please try again, or ask me to connect you with a human agent.";

export async function runAgent(
  messages: ChatMessage[],
  generate: GenerateFn,
  execute: ToolExecutor,
): Promise<AgentResult> {
  const contents: Content[] = messages.map((m) => ({ role: m.role, parts: [{ text: m.text }] }));
  const toolCalls: AgentResult['toolCalls'] = [];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const turn = await generate(contents);

    if (turn.functionCalls.length === 0) {
      return { reply: turn.text.trim() || FALLBACK_REPLY, toolCalls };
    }

    contents.push(turn.content);
    const responseParts = [];
    for (const [i, call] of turn.functionCalls.entries()) {
      // Every call needs an answer, but we only RUN a limited number.
      const result: ToolResult =
        i < MAX_CALLS_PER_ROUND
          ? await execute(call.name, call.args)
          : { ok: false, error: 'Too many tool calls at once; this one was skipped.' };
      toolCalls.push({ name: call.name, ok: result.ok === true });
      responseParts.push({
        functionResponse: { name: call.name, response: result, ...(call.id ? { id: call.id } : {}) },
      });
    }
    contents.push({ role: 'user', parts: responseParts });
  }

  return { reply: FALLBACK_REPLY, toolCalls };
}
