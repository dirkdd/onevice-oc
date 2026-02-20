// Session manager for OneVice intelligence layer
// Per-user conversation history stored in agent_sessions.state JSONB
// Messages are windowed to the last 20 to prevent unbounded growth

import type { ChatMessage } from "../llm/router.js";
import { getOrCreateSession, updateSessionState } from "../db/supabase.js";
import type { AgentSession } from "../types/index.js";

const MAX_HISTORY_MESSAGES = 20;

type SessionMessages = {
  session: AgentSession;
  messages: ChatMessage[];
};

export async function loadSessionMessages(
  userId: string,
  agentId: string,
  conversationId: string,
): Promise<SessionMessages> {
  const session = await getOrCreateSession(userId, agentId, conversationId);

  const state = session.state as { messages?: ChatMessage[] } | undefined;
  const messages = Array.isArray(state?.messages) ? state.messages : [];

  return { session, messages };
}

export async function saveSessionMessages(
  sessionId: string,
  existingMessages: ChatMessage[],
  newMessages: ChatMessage[],
): Promise<void> {
  const allMessages = [...existingMessages, ...newMessages];

  // Window to last N messages to prevent unbounded growth
  const windowed = allMessages.length > MAX_HISTORY_MESSAGES
    ? allMessages.slice(-MAX_HISTORY_MESSAGES)
    : allMessages;

  // Add timestamps to new messages
  const timestamped = windowed.map((msg) => ({
    ...msg,
    timestamp: (msg as { timestamp?: string }).timestamp ?? new Date().toISOString(),
  }));

  await updateSessionState(sessionId, { messages: timestamped });
}

export async function clearSessionMessages(sessionId: string): Promise<void> {
  await updateSessionState(sessionId, { messages: [] });
}
