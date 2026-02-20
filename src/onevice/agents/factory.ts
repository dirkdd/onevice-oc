// Agent factory for OneVice intelligence layer
// Converts UserAgentConfig (DB row) into AgentConfig (runtime config for orchestrator)
// No caching — fresh config each call so user updates take effect immediately

import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { UserAgentConfig } from "../types/index.js";
import type { AgentConfig } from "./configs.js";
import { getAgentConfig } from "./configs.js";
import { getAllGraphTools } from "../tools/graph-tools.js";
import { getAllBidTools } from "../tools/bid-tools.js";
import { getAllFolkTools } from "../tools/folk-crm.js";

// oxlint-disable-next-line typescript/no-explicit-any
let toolRegistry: Map<string, AgentTool<any>> | null = null;

// oxlint-disable-next-line typescript/no-explicit-any
function getToolRegistry(): Map<string, AgentTool<any>> {
  if (toolRegistry) return toolRegistry;

  toolRegistry = new Map();
  for (const tool of getAllGraphTools()) {
    toolRegistry.set(tool.name, tool);
  }
  for (const tool of getAllBidTools()) {
    toolRegistry.set(tool.name, tool);
  }
  for (const tool of getAllFolkTools()) {
    toolRegistry.set(tool.name, tool);
  }
  return toolRegistry;
}

export function getValidToolNames(): string[] {
  return [...getToolRegistry().keys()];
}

// oxlint-disable-next-line typescript/no-explicit-any
function resolveTools(toolNames: string[]): AgentTool<any>[] {
  const registry = getToolRegistry();
  // oxlint-disable-next-line typescript/no-explicit-any
  const resolved: AgentTool<any>[] = [];
  for (const name of toolNames) {
    const tool = registry.get(name);
    if (tool) resolved.push(tool);
  }
  return resolved;
}

function stripModelPrefix(modelPref: string): string | undefined {
  // Remove together/ or anthropic/ prefix — the LLM router selects provider by sensitivity
  const stripped = modelPref.replace(/^(together|anthropic)\//, "");
  return stripped || undefined;
}

const DEFAULT_CUSTOM_PROMPT = `You are a custom OneVice AI assistant for the entertainment industry.
Use the tools available to you to answer questions accurately and concisely.
If data is not found, suggest alternative approaches.`;

export function buildAgentConfigFromUser(userConfig: UserAgentConfig): AgentConfig {
  const agentType = userConfig.agent_type;

  if (agentType === "custom") {
    // Custom agent: use user's prompt + tools directly
    const tools = userConfig.tools_enabled.length > 0
      ? resolveTools(userConfig.tools_enabled)
      : resolveTools(getValidToolNames()); // all tools if none specified

    return {
      type: "custom",
      systemPrompt: userConfig.system_prompt || DEFAULT_CUSTOM_PROMPT,
      tools,
      defaultModel: stripModelPrefix(userConfig.model_preference),
    };
  }

  // Standard type (sales/talent/bidding): start from built-in config, override as needed
  const baseConfig = getAgentConfig(agentType);

  const systemPrompt = userConfig.system_prompt || baseConfig.systemPrompt;

  // If user specified tools, restrict to their selection; otherwise use built-in set
  const tools = userConfig.tools_enabled.length > 0
    ? resolveTools(userConfig.tools_enabled)
    : baseConfig.tools;

  return {
    type: agentType,
    systemPrompt,
    tools,
    defaultModel: stripModelPrefix(userConfig.model_preference),
  };
}
