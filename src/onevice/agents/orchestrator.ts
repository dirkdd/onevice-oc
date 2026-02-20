// Orchestrator for OneVice intelligence layer
// Implements a simple ReAct loop: classify → build messages → LLM call → tool execution → repeat
// Uses native tool execution (not LangGraph)
// Phase 4: supports per-user agent configs and conversation history

import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { QueryRequest, QueryResponse } from "../types/index.js";
import { classifyQuery, getAgentConfig, type AgentConfig } from "./configs.js";
import { buildAgentConfigFromUser } from "./factory.js";
import { loadSessionMessages, saveSessionMessages } from "./session-manager.js";
import { getUserAgent } from "../db/supabase.js";
import {
  chatCompletion,
  toolToFunctionDef,
  type ChatMessage,
  type ToolDefinition,
} from "../llm/router.js";

const MAX_ITERATIONS = 5;

// Convert AgentTool[] to OpenAI function-calling definitions
// oxlint-disable-next-line typescript/no-explicit-any
function convertToolsToFunctionDefs(tools: AgentTool<any>[]): ToolDefinition[] {
  return tools.map(toolToFunctionDef);
}

export async function runQuery(request: QueryRequest): Promise<QueryResponse> {
  const startTime = Date.now();

  // 1. Resolve agent config — user agent takes priority over classification
  let config: AgentConfig;
  let agentType: string;
  let routingStrategy: string;
  let primaryAgent: string;
  let sessionId: string | null = null;
  let historyMessages: ChatMessage[] = [];

  if (request.agent_id) {
    // Try to load user agent from Supabase
    try {
      const userAgent = await getUserAgent(request.agent_id);
      if (userAgent && userAgent.is_active) {
        config = buildAgentConfigFromUser(userAgent);
        agentType = userAgent.agent_type;
        routingStrategy = "user_agent";
        primaryAgent = `user_agent:${userAgent.id}`;

        // Load session history (non-fatal on failure)
        try {
          const session = await loadSessionMessages(
            request.user_context.user_id,
            userAgent.id,
            request.conversation_id,
          );
          sessionId = session.session.id;
          historyMessages = session.messages;
        } catch {
          // Session load failure is non-fatal — proceed without history
        }
      } else {
        // Agent not found or inactive — fall back to classification
        agentType = request.agent_type ?? classifyQuery(request.message);
        config = getAgentConfig(agentType);
        routingStrategy = "fallback_classified";
        primaryAgent = `${agentType}_intelligence`;
      }
    } catch {
      // Supabase error — fall back to classification
      agentType = request.agent_type ?? classifyQuery(request.message);
      config = getAgentConfig(agentType);
      routingStrategy = "fallback_classified";
      primaryAgent = `${agentType}_intelligence`;
    }
  } else {
    // No agent_id — use existing classification logic (unchanged)
    agentType = request.agent_type ?? classifyQuery(request.message);
    config = getAgentConfig(agentType);
    routingStrategy = request.agent_type ? "direct" : "auto_classified";
    primaryAgent = `${agentType}_intelligence`;
  }

  // 2. Build initial messages with history
  const messages: ChatMessage[] = [
    ...historyMessages,
    { role: "user", content: request.message },
  ];
  const newMessagesStartIndex = messages.length - 1; // index of the new user message

  // 3. Convert tools to function defs
  const toolDefs = convertToolsToFunctionDefs(config.tools);

  // 4. ReAct loop
  const toolsUsed: string[] = [];

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const response = await chatCompletion({
      systemPrompt: config.systemPrompt,
      messages,
      tools: toolDefs.length > 0 ? toolDefs : undefined,
      dataSensitivity: request.user_context.data_sensitivity,
      model: config.defaultModel,
      temperature: undefined, // use default from LLM router
    });

    // If no tool calls, return the final text
    if (response.stopReason === "stop" || response.toolCalls.length === 0) {
      // Save session (non-fatal on failure)
      if (sessionId) {
        const finalAssistantMsg: ChatMessage = { role: "assistant", content: response.text || "" };
        const newMessages = messages.slice(newMessagesStartIndex).concat(finalAssistantMsg);
        try {
          await saveSessionMessages(sessionId, historyMessages, newMessages);
        } catch {
          // Session save failure is non-fatal
        }
      }

      return {
        content: response.text || "[No response generated]",
        agent_info: {
          type: agentType,
          primary_agent: primaryAgent,
          routing_strategy: routingStrategy,
          agents_used: toolsUsed.length > 0 ? toolsUsed : undefined,
        },
        conversation_id: request.conversation_id,
        timestamp: new Date().toISOString(),
      };
    }

    // Build assistant message with tool calls
    const assistantMsg: ChatMessage = {
      role: "assistant",
      content: response.text || "",
      tool_calls: response.toolCalls.map((tc) => ({
        id: tc.id,
        type: "function" as const,
        function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
      })),
    };
    messages.push(assistantMsg);

    // Execute each tool call
    for (const toolCall of response.toolCalls) {
      const tool = config.tools.find((t) => t.name === toolCall.name);

      let resultText: string;
      if (tool) {
        try {
          const result = await tool.execute(toolCall.id, toolCall.arguments);
          // Extract text from AgentToolResult
          resultText = result.content
            .filter((c): c is { type: "text"; text: string } => c.type === "text")
            .map((c) => c.text)
            .join("\n");
          toolsUsed.push(toolCall.name);
        } catch (e) {
          resultText = JSON.stringify({ error: `Tool execution failed: ${e}` });
        }
      } else {
        resultText = JSON.stringify({ error: `Unknown tool: ${toolCall.name}` });
      }

      messages.push({
        role: "tool",
        content: resultText,
        tool_call_id: toolCall.id,
      });
    }
  }

  // Max iterations reached — save session and return what we have
  if (sessionId) {
    const newMessages = messages.slice(newMessagesStartIndex);
    try {
      await saveSessionMessages(sessionId, historyMessages, newMessages);
    } catch {
      // Session save failure is non-fatal
    }
  }

  const lastAssistant = messages.filter((m) => m.role === "assistant").pop();
  return {
    content:
      lastAssistant?.content ||
      "[Max iterations reached — partial results may be available from tool calls]",
    agent_info: {
      type: agentType,
      primary_agent: primaryAgent,
      routing_strategy: routingStrategy,
      agents_used: toolsUsed,
    },
    conversation_id: request.conversation_id,
    timestamp: new Date().toISOString(),
  };
}
