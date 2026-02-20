import type { IncomingMessage, ServerResponse } from "node:http";
import type { PluginLogger } from "../../../src/plugins/types.js";
import {
  validateServiceKey,
  parseUserContext,
  sendUnauthorized,
  sendJson,
  sendError,
  readJsonBody,
} from "./service-auth.js";

type QueryRequest = {
  message: string;
  user_context: Record<string, unknown>;
  conversation_id: string;
  agent_id?: string;
  agent_type?: string;
};

type AgentCreateRequest = {
  agent_name: string;
  agent_type: string;
  system_prompt?: string;
  tools_enabled?: string[];
  model_preference?: string;
  temperature?: number;
};

export function createQueryHandler(logger: PluginLogger) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (!validateServiceKey(req)) {
      sendUnauthorized(res, "Invalid or missing service key");
      return;
    }

    const body = await readJsonBody<QueryRequest>(req);
    if (!body?.message) {
      sendError(res, "Missing required field: message", 400);
      return;
    }

    logger.info(`[onevice] Query received: ${body.message.slice(0, 80)}...`);

    // For now, return a structured placeholder response.
    // Phase 3 will wire this to the LangGraph.js orchestrator.
    const response = {
      content: `[OneVice Intelligence] Received query: "${body.message.slice(0, 100)}".\n\nThis endpoint is ready for orchestrator integration (Phase 3).`,
      agent_info: {
        type: "openclaw",
        primary_agent: body.agent_type ?? "auto",
        routing_strategy: "placeholder",
      },
      conversation_id: body.conversation_id ?? "unknown",
      timestamp: new Date().toISOString(),
    };

    sendJson(res, response);
  };
}

export function createAgentQueryHandler(logger: PluginLogger) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (!validateServiceKey(req)) {
      sendUnauthorized(res, "Invalid or missing service key");
      return;
    }

    // Extract agent type from URL path: /onevice/agents/:type/query
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const parts = url.pathname.split("/").filter(Boolean);
    // Expected: ["onevice", "agents", "<type>", "query"]
    const agentType = parts[2] ?? "unknown";

    const body = await readJsonBody<QueryRequest>(req);
    if (!body?.message) {
      sendError(res, "Missing required field: message", 400);
      return;
    }

    logger.info(`[onevice] Direct agent query (${agentType}): ${body.message.slice(0, 80)}...`);

    const response = {
      content: `[OneVice ${agentType}] Received query: "${body.message.slice(0, 100)}".\n\nDirect agent routing ready for Phase 3 integration.`,
      agent_info: {
        type: "openclaw",
        primary_agent: agentType,
        routing_strategy: "direct",
      },
      conversation_id: body.conversation_id ?? "unknown",
      timestamp: new Date().toISOString(),
    };

    sendJson(res, response);
  };
}

export function createStatusHandler(logger: PluginLogger) {
  return async (_req: IncomingMessage, res: ServerResponse): Promise<void> => {
    // Status endpoint doesn't require service key — used for health checks
    const status = {
      status: "healthy",
      service: "onevice-intelligence",
      version: "0.1.0",
      agents: {
        sales: { status: "placeholder", ready: false },
        talent: { status: "placeholder", ready: false },
        bidding: { status: "placeholder", ready: false },
      },
      providers: {
        together: { configured: !!process.env.TOGETHER_API_KEY },
        anthropic: { configured: !!process.env.ANTHROPIC_API_KEY },
      },
      timestamp: new Date().toISOString(),
    };

    sendJson(res, status);
  };
}

// Agent CRUD handlers (Phase 4 - per-user agents)
// For now these are stubbed; Phase 4 will connect them to Supabase user_agents table

export function createListAgentsHandler(logger: PluginLogger) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (!validateServiceKey(req)) {
      sendUnauthorized(res, "Invalid or missing service key");
      return;
    }

    const userCtx = parseUserContext(req);
    logger.info(`[onevice] List agents for user: ${userCtx?.user_id ?? "unknown"}`);

    // Stub: return empty list until Phase 4 connects Supabase
    sendJson(res, []);
  };
}

export function createCreateAgentHandler(logger: PluginLogger) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (!validateServiceKey(req)) {
      sendUnauthorized(res, "Invalid or missing service key");
      return;
    }

    const body = await readJsonBody<AgentCreateRequest>(req);
    if (!body?.agent_name || !body?.agent_type) {
      sendError(res, "Missing required fields: agent_name, agent_type", 400);
      return;
    }

    const userCtx = parseUserContext(req);
    logger.info(`[onevice] Create agent "${body.agent_name}" for user: ${userCtx?.user_id ?? "unknown"}`);

    // Stub: echo back as created until Phase 4
    const agent = {
      id: crypto.randomUUID(),
      user_id: userCtx?.user_id ?? "unknown",
      agent_name: body.agent_name,
      agent_type: body.agent_type,
      system_prompt: body.system_prompt ?? null,
      tools_enabled: body.tools_enabled ?? [],
      model_preference: body.model_preference ?? "together/meta-llama/Llama-3.3-70B-Instruct-Turbo",
      temperature: body.temperature ?? 0.7,
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    sendJson(res, agent, 201);
  };
}

export function createUpdateAgentHandler(logger: PluginLogger) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (!validateServiceKey(req)) {
      sendUnauthorized(res, "Invalid or missing service key");
      return;
    }

    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const parts = url.pathname.split("/").filter(Boolean);
    const agentId = parts[2] ?? "unknown";

    const body = await readJsonBody<Partial<AgentCreateRequest>>(req);
    logger.info(`[onevice] Update agent ${agentId}`);

    // Stub response
    sendJson(res, { id: agentId, ...body, updated_at: new Date().toISOString() });
  };
}

export function createDeleteAgentHandler(logger: PluginLogger) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (!validateServiceKey(req)) {
      sendUnauthorized(res, "Invalid or missing service key");
      return;
    }

    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const parts = url.pathname.split("/").filter(Boolean);
    const agentId = parts[2] ?? "unknown";

    logger.info(`[onevice] Delete agent ${agentId}`);

    sendJson(res, { id: agentId, is_active: false, deactivated_at: new Date().toISOString() });
  };
}
