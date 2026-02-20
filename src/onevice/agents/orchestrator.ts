// Orchestrator for OneVice intelligence layer
// Implements a simple ReAct loop: classify → build messages → LLM call → tool execution → repeat
// Uses native tool execution (not LangGraph)

import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { QueryRequest, QueryResponse } from "../types/index.js";
import { classifyQuery, getAgentConfig } from "./configs.js";
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

  // 1. Classify query → pick agent config
  const agentType = request.agent_type ?? classifyQuery(request.message);
  const config = getAgentConfig(agentType);

  // 2. Build initial messages
  const messages: ChatMessage[] = [{ role: "user", content: request.message }];

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
    });

    // If no tool calls, return the final text
    if (response.stopReason === "stop" || response.toolCalls.length === 0) {
      return {
        content: response.text || "[No response generated]",
        agent_info: {
          type: agentType,
          primary_agent: `${agentType}_intelligence`,
          routing_strategy: request.agent_type ? "direct" : "auto_classified",
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

  // Max iterations reached — return what we have
  const lastAssistant = messages.filter((m) => m.role === "assistant").pop();
  return {
    content:
      lastAssistant?.content ||
      "[Max iterations reached — partial results may be available from tool calls]",
    agent_info: {
      type: agentType,
      primary_agent: `${agentType}_intelligence`,
      routing_strategy: "auto_classified",
      agents_used: toolsUsed,
    },
    conversation_id: request.conversation_id,
    timestamp: new Date().toISOString(),
  };
}
