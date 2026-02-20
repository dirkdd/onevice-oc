// Supabase client for OneVice intelligence layer
// Used for user_agents table, agent_sessions, and structured data

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { UserAgentConfig, AgentSession } from "../types/index.js";

let client: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (client) return client;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
  }

  client = createClient(url, key);
  return client;
}

// User agent CRUD operations

export async function listUserAgents(userId: string): Promise<UserAgentConfig[]> {
  const sb = getSupabaseClient();
  const { data, error } = await sb
    .from("user_agents")
    .select("*")
    .eq("user_id", userId)
    .eq("is_active", true)
    .order("created_at", { ascending: false });

  if (error) throw new Error(`Failed to list user agents: ${error.message}`);
  return data ?? [];
}

export async function getUserAgent(agentId: string): Promise<UserAgentConfig | null> {
  const sb = getSupabaseClient();
  const { data, error } = await sb
    .from("user_agents")
    .select("*")
    .eq("id", agentId)
    .single();

  if (error) return null;
  return data;
}

export async function createUserAgent(
  agent: Omit<UserAgentConfig, "id" | "created_at" | "updated_at">,
): Promise<UserAgentConfig> {
  const sb = getSupabaseClient();
  const { data, error } = await sb
    .from("user_agents")
    .insert(agent)
    .select()
    .single();

  if (error) throw new Error(`Failed to create agent: ${error.message}`);
  return data;
}

export async function updateUserAgent(
  agentId: string,
  updates: Partial<UserAgentConfig>,
): Promise<UserAgentConfig> {
  const sb = getSupabaseClient();
  const { data, error } = await sb
    .from("user_agents")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", agentId)
    .select()
    .single();

  if (error) throw new Error(`Failed to update agent: ${error.message}`);
  return data;
}

export async function deactivateUserAgent(agentId: string): Promise<void> {
  const sb = getSupabaseClient();
  const { error } = await sb
    .from("user_agents")
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq("id", agentId);

  if (error) throw new Error(`Failed to deactivate agent: ${error.message}`);
}

// Agent session operations

export async function getOrCreateSession(
  userId: string,
  agentId: string,
  conversationId: string,
): Promise<AgentSession> {
  const sb = getSupabaseClient();

  // Try to find existing session
  const { data: existing } = await sb
    .from("agent_sessions")
    .select("*")
    .eq("user_id", userId)
    .eq("agent_id", agentId)
    .eq("conversation_id", conversationId)
    .single();

  if (existing) {
    // Update last_active
    await sb
      .from("agent_sessions")
      .update({ last_active: new Date().toISOString() })
      .eq("id", existing.id);
    return existing;
  }

  // Create new session
  const { data, error } = await sb
    .from("agent_sessions")
    .insert({ user_id: userId, agent_id: agentId, conversation_id: conversationId, state: {} })
    .select()
    .single();

  if (error) throw new Error(`Failed to create session: ${error.message}`);
  return data;
}

export async function updateSessionState(
  sessionId: string,
  state: Record<string, unknown>,
): Promise<void> {
  const sb = getSupabaseClient();
  const { error } = await sb
    .from("agent_sessions")
    .update({ state, last_active: new Date().toISOString() })
    .eq("id", sessionId);

  if (error) throw new Error(`Failed to update session state: ${error.message}`);
}

export async function verifyConnection(): Promise<boolean> {
  try {
    const sb = getSupabaseClient();
    const { error } = await sb.from("user_agents").select("id").limit(1);
    return !error;
  } catch {
    return false;
  }
}
