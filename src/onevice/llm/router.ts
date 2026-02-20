// LLM router for OneVice intelligence layer
// Routes requests to Together.ai or Anthropic based on data sensitivity
// Uses direct fetch() to OpenAI-compatible APIs

import type { DataSensitivityLevel } from "../types/index.js";

export type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_call_id?: string;
  tool_calls?: ToolCallMessage[];
};

export type ToolCallMessage = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export type ToolDefinition = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export type ChatCompletionResponse = {
  text: string;
  stopReason: "stop" | "tool_calls" | "length" | "unknown";
  toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
  model: string;
  usage?: { prompt_tokens: number; completion_tokens: number };
};

type CompletionOptions = {
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  systemPrompt?: string;
  model?: string;
  temperature?: number;
  dataSensitivity?: DataSensitivityLevel;
};

// Provider config
const TOGETHER_URL = "https://api.together.xyz/v1/chat/completions";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_TOGETHER_MODEL = "meta-llama/Llama-3.3-70B-Instruct-Turbo";
const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-6";

function getProvider(sensitivity: DataSensitivityLevel): "together" | "anthropic" {
  // Levels 1-4 → Together.ai, Levels 5-6 → Anthropic
  return sensitivity >= 5 ? "anthropic" : "together";
}

async function callTogether(opts: CompletionOptions): Promise<ChatCompletionResponse> {
  const apiKey = process.env.TOGETHER_API_KEY;
  if (!apiKey) throw new Error("TOGETHER_API_KEY not configured");

  const model = opts.model ?? DEFAULT_TOGETHER_MODEL;
  const messages: Array<Record<string, unknown>> = [];

  if (opts.systemPrompt) {
    messages.push({ role: "system", content: opts.systemPrompt });
  }
  for (const msg of opts.messages) {
    messages.push({ ...msg });
  }

  const body: Record<string, unknown> = {
    model,
    messages,
    temperature: opts.temperature ?? 0.7,
    max_tokens: 4096,
  };

  if (opts.tools && opts.tools.length > 0) {
    body.tools = opts.tools;
    body.tool_choice = "auto";
  }

  const res = await fetch(TOGETHER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Together.ai ${res.status}: ${text}`);
  }

  const data = (await res.json()) as {
    choices: Array<{
      message: { content?: string; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> };
      finish_reason: string;
    }>;
    model: string;
    usage?: { prompt_tokens: number; completion_tokens: number };
  };

  const choice = data.choices[0];
  const toolCalls = (choice.message.tool_calls ?? []).map((tc) => ({
    id: tc.id,
    name: tc.function.name,
    arguments: JSON.parse(tc.function.arguments) as Record<string, unknown>,
  }));

  return {
    text: choice.message.content ?? "",
    stopReason: choice.finish_reason === "tool_calls" ? "tool_calls" : choice.finish_reason === "stop" ? "stop" : "unknown",
    toolCalls,
    model: data.model,
    usage: data.usage,
  };
}

async function callAnthropic(opts: CompletionOptions): Promise<ChatCompletionResponse> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");

  const model = opts.model ?? DEFAULT_ANTHROPIC_MODEL;

  // Convert to Anthropic message format
  const messages: Array<Record<string, unknown>> = [];
  for (const msg of opts.messages) {
    if (msg.role === "tool") {
      messages.push({
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: msg.tool_call_id,
            content: msg.content,
          },
        ],
      });
    } else if (msg.role === "assistant" && msg.tool_calls) {
      const content: unknown[] = [];
      if (msg.content) content.push({ type: "text", text: msg.content });
      for (const tc of msg.tool_calls) {
        content.push({
          type: "tool_use",
          id: tc.id,
          name: tc.function.name,
          input: JSON.parse(tc.function.arguments),
        });
      }
      messages.push({ role: "assistant", content });
    } else {
      messages.push({ role: msg.role, content: msg.content });
    }
  }

  // Convert tools to Anthropic format
  const tools = (opts.tools ?? []).map((t) => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: t.function.parameters,
  }));

  const body: Record<string, unknown> = {
    model,
    messages,
    max_tokens: 4096,
    temperature: opts.temperature ?? 0.7,
  };

  if (opts.systemPrompt) {
    body.system = opts.systemPrompt;
  }
  if (tools.length > 0) {
    body.tools = tools;
  }

  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Anthropic ${res.status}: ${text}`);
  }

  const data = (await res.json()) as {
    content: Array<{ type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }>;
    stop_reason: string;
    model: string;
    usage?: { input_tokens: number; output_tokens: number };
  };

  let text = "";
  const toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }> = [];

  for (const block of data.content) {
    if (block.type === "text") {
      text += block.text ?? "";
    } else if (block.type === "tool_use") {
      toolCalls.push({
        id: block.id!,
        name: block.name!,
        arguments: block.input ?? {},
      });
    }
  }

  return {
    text,
    stopReason: data.stop_reason === "tool_use" ? "tool_calls" : data.stop_reason === "end_turn" ? "stop" : "unknown",
    toolCalls,
    model: data.model,
    usage: data.usage ? { prompt_tokens: data.usage.input_tokens, completion_tokens: data.usage.output_tokens } : undefined,
  };
}

export async function chatCompletion(opts: CompletionOptions): Promise<ChatCompletionResponse> {
  const sensitivity = opts.dataSensitivity ?? 1;
  const provider = getProvider(sensitivity);

  if (provider === "anthropic") {
    return callAnthropic(opts);
  }
  return callTogether(opts);
}

// Convert AgentTool parameter schemas to OpenAI function-calling format
export function toolToFunctionDef(tool: { name: string; description: string; parameters: unknown }): ToolDefinition {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters as Record<string, unknown>,
    },
  };
}
