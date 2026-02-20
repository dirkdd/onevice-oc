import type { IncomingMessage, ServerResponse } from "node:http";
import type { PluginLogger } from "../../../src/plugins/types.js";
import {
  validateServiceKey,
  parseUserContext,
  getUserIdFromRequest,
  sendUnauthorized,
  sendJson,
  sendError,
  readJsonBody,
} from "./service-auth.js";
import { runQuery } from "../../../src/onevice/agents/orchestrator.js";
import type { QueryRequest as OrchestratorRequest } from "../../../src/onevice/types/index.js";
import type { AgentType, DataSensitivityLevel, UserRole } from "../../../src/onevice/types/index.js";
import { getAllGraphTools } from "../../../src/onevice/tools/graph-tools.js";
import { getAllBidTools } from "../../../src/onevice/tools/bid-tools.js";
import { getAllFolkTools } from "../../../src/onevice/tools/folk-crm.js";
import {
  listUserAgents,
  getUserAgent,
  createUserAgent,
  updateUserAgent,
  deactivateUserAgent,
} from "../../../src/onevice/db/supabase.js";
import { getValidToolNames } from "../../../src/onevice/agents/factory.js";

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

const VALID_AGENT_TYPES = new Set(["sales", "talent", "bidding", "custom"]);

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

    const userCtx = parseUserContext(req);
    const orchestratorRequest: OrchestratorRequest = {
      message: body.message,
      user_context: {
        user_id: userCtx?.user_id ?? "anonymous",
        role: (userCtx?.role ?? "SALESPERSON") as UserRole,
        data_sensitivity: (userCtx?.data_sensitivity ?? 1) as DataSensitivityLevel,
        department: userCtx?.department,
      },
      conversation_id: body.conversation_id ?? crypto.randomUUID(),
      agent_id: body.agent_id,
      agent_type: body.agent_type as AgentType | undefined,
    };

    try {
      const response = await runQuery(orchestratorRequest);
      sendJson(res, response);
    } catch (e) {
      logger.error(`[onevice] Orchestrator error: ${e}`);
      sendError(res, `Query processing failed: ${e}`, 500);
    }
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

    const userCtx = parseUserContext(req);
    const orchestratorRequest: OrchestratorRequest = {
      message: body.message,
      user_context: {
        user_id: userCtx?.user_id ?? "anonymous",
        role: (userCtx?.role ?? "SALESPERSON") as UserRole,
        data_sensitivity: (userCtx?.data_sensitivity ?? 1) as DataSensitivityLevel,
        department: userCtx?.department,
      },
      conversation_id: body.conversation_id ?? crypto.randomUUID(),
      agent_id: body.agent_id,
      agent_type: agentType as AgentType,
    };

    try {
      const response = await runQuery(orchestratorRequest);
      sendJson(res, response);
    } catch (e) {
      logger.error(`[onevice] Direct agent error: ${e}`);
      sendError(res, `Query processing failed: ${e}`, 500);
    }
  };
}

export function createStatusHandler(logger: PluginLogger) {
  return async (_req: IncomingMessage, res: ServerResponse): Promise<void> => {
    // Status endpoint doesn't require service key — used for health checks
    const graphTools = getAllGraphTools();
    const bidTools = getAllBidTools();
    const folkTools = getAllFolkTools();
    const totalTools = graphTools.length + bidTools.length + folkTools.length;

    const status = {
      status: "healthy",
      service: "onevice-intelligence",
      version: "0.2.0",
      agents: {
        sales: { status: "active", ready: true, tools: 7 },
        talent: { status: "active", ready: true, tools: 8 },
        bidding: { status: "active", ready: true, tools: 10 },
      },
      tools: {
        graph: graphTools.map((t) => t.name),
        bid: bidTools.map((t) => t.name),
        folk: folkTools.map((t) => t.name),
        total: totalTools,
      },
      providers: {
        together: { configured: !!process.env.TOGETHER_API_KEY },
        anthropic: { configured: !!process.env.ANTHROPIC_API_KEY },
        folk: { configured: !!(process.env.FOLK_API_KEY_1 || process.env.FOLK_API_KEY_2) },
      },
      timestamp: new Date().toISOString(),
    };

    sendJson(res, status);
  };
}

// Agent CRUD handlers (Phase 4 - per-user agents, wired to Supabase)

export function createListAgentsHandler(logger: PluginLogger) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (!validateServiceKey(req)) {
      sendUnauthorized(res, "Invalid or missing service key");
      return;
    }

    const userId = getUserIdFromRequest(req);
    if (!userId) {
      sendError(res, "Missing user ID (X-User-Context or X-User-Id header required)", 400);
      return;
    }

    logger.info(`[onevice] List agents for user: ${userId}`);

    try {
      const agents = await listUserAgents(userId);
      sendJson(res, agents);
    } catch (e) {
      logger.error(`[onevice] Failed to list agents: ${e}`);
      sendError(res, `Failed to list agents: ${e}`, 500);
    }
  };
}

export function createCreateAgentHandler(logger: PluginLogger) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (!validateServiceKey(req)) {
      sendUnauthorized(res, "Invalid or missing service key");
      return;
    }

    const userId = getUserIdFromRequest(req);
    if (!userId) {
      sendError(res, "Missing user ID (X-User-Context or X-User-Id header required)", 400);
      return;
    }

    const body = await readJsonBody<AgentCreateRequest>(req);
    if (!body?.agent_name || !body?.agent_type) {
      sendError(res, "Missing required fields: agent_name, agent_type", 400);
      return;
    }

    // Validate agent_type
    if (!VALID_AGENT_TYPES.has(body.agent_type)) {
      sendError(res, `Invalid agent_type: ${body.agent_type}. Must be one of: sales, talent, bidding, custom`, 400);
      return;
    }

    // Validate tools_enabled
    if (body.tools_enabled && body.tools_enabled.length > 0) {
      const validNames = new Set(getValidToolNames());
      const invalid = body.tools_enabled.filter((t) => !validNames.has(t));
      if (invalid.length > 0) {
        sendError(res, `Invalid tool names: ${invalid.join(", ")}`, 400);
        return;
      }
    }

    // Validate temperature
    if (body.temperature !== undefined && (body.temperature < 0 || body.temperature > 2)) {
      sendError(res, "Temperature must be between 0 and 2", 400);
      return;
    }

    logger.info(`[onevice] Create agent "${body.agent_name}" for user: ${userId}`);

    try {
      const agent = await createUserAgent({
        user_id: userId,
        agent_name: body.agent_name,
        agent_type: body.agent_type as AgentType,
        system_prompt: body.system_prompt,
        tools_enabled: body.tools_enabled ?? [],
        model_preference: body.model_preference ?? "meta-llama/Llama-3.3-70B-Instruct-Turbo",
        temperature: body.temperature ?? 0.7,
        is_active: true,
      });
      sendJson(res, agent, 201);
    } catch (e) {
      logger.error(`[onevice] Failed to create agent: ${e}`);
      sendError(res, `Failed to create agent: ${e}`, 500);
    }
  };
}

export function createUpdateAgentHandler(logger: PluginLogger) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (!validateServiceKey(req)) {
      sendUnauthorized(res, "Invalid or missing service key");
      return;
    }

    const userId = getUserIdFromRequest(req);
    if (!userId) {
      sendError(res, "Missing user ID (X-User-Context or X-User-Id header required)", 400);
      return;
    }

    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const parts = url.pathname.split("/").filter(Boolean);
    const agentId = parts[2] ?? "";

    if (!agentId) {
      sendError(res, "Missing agent ID in URL path", 400);
      return;
    }

    // Ownership check
    const existing = await getUserAgent(agentId);
    if (!existing) {
      sendError(res, "Agent not found", 404);
      return;
    }
    if (existing.user_id !== userId) {
      sendError(res, "Forbidden: agent belongs to another user", 403);
      return;
    }

    const body = await readJsonBody<Partial<AgentCreateRequest>>(req);
    if (!body) {
      sendError(res, "Invalid request body", 400);
      return;
    }

    // Validate tools_enabled if provided
    if (body.tools_enabled && body.tools_enabled.length > 0) {
      const validNames = new Set(getValidToolNames());
      const invalid = body.tools_enabled.filter((t) => !validNames.has(t));
      if (invalid.length > 0) {
        sendError(res, `Invalid tool names: ${invalid.join(", ")}`, 400);
        return;
      }
    }

    // Validate temperature if provided
    if (body.temperature !== undefined && (body.temperature < 0 || body.temperature > 2)) {
      sendError(res, "Temperature must be between 0 and 2", 400);
      return;
    }

    logger.info(`[onevice] Update agent ${agentId} for user: ${userId}`);

    try {
      const updated = await updateUserAgent(agentId, {
        ...(body.agent_name !== undefined && { agent_name: body.agent_name }),
        ...(body.agent_type !== undefined && { agent_type: body.agent_type as AgentType }),
        ...(body.system_prompt !== undefined && { system_prompt: body.system_prompt }),
        ...(body.tools_enabled !== undefined && { tools_enabled: body.tools_enabled }),
        ...(body.model_preference !== undefined && { model_preference: body.model_preference }),
        ...(body.temperature !== undefined && { temperature: body.temperature }),
      });
      sendJson(res, updated);
    } catch (e) {
      logger.error(`[onevice] Failed to update agent: ${e}`);
      sendError(res, `Failed to update agent: ${e}`, 500);
    }
  };
}

export function createDeleteAgentHandler(logger: PluginLogger) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (!validateServiceKey(req)) {
      sendUnauthorized(res, "Invalid or missing service key");
      return;
    }

    const userId = getUserIdFromRequest(req);
    if (!userId) {
      sendError(res, "Missing user ID (X-User-Context or X-User-Id header required)", 400);
      return;
    }

    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const parts = url.pathname.split("/").filter(Boolean);
    const agentId = parts[2] ?? "";

    if (!agentId) {
      sendError(res, "Missing agent ID in URL path", 400);
      return;
    }

    // Ownership check
    const existing = await getUserAgent(agentId);
    if (!existing) {
      sendError(res, "Agent not found", 404);
      return;
    }
    if (existing.user_id !== userId) {
      sendError(res, "Forbidden: agent belongs to another user", 403);
      return;
    }

    logger.info(`[onevice] Delete agent ${agentId} for user: ${userId}`);

    try {
      await deactivateUserAgent(agentId);
      sendJson(res, { id: agentId, is_active: false, deactivated_at: new Date().toISOString() });
    } catch (e) {
      logger.error(`[onevice] Failed to deactivate agent: ${e}`);
      sendError(res, `Failed to deactivate agent: ${e}`, 500);
    }
  };
}
