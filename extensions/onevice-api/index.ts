import type { IncomingMessage, ServerResponse } from "node:http";
import type { OpenClawPluginApi } from "../../src/plugins/types.js";
import {
  createQueryHandler,
  createAgentQueryHandler,
  createStatusHandler,
  createListAgentsHandler,
  createCreateAgentHandler,
  createUpdateAgentHandler,
  createDeleteAgentHandler,
} from "./src/routes.js";
import { getAllGraphTools } from "../../src/onevice/tools/graph-tools.js";
import { getAllBidTools } from "../../src/onevice/tools/bid-tools.js";
import { getAllFolkTools } from "../../src/onevice/tools/folk-crm.js";

export default function register(api: OpenClawPluginApi) {
  const logger = api.logger;

  logger.info("[onevice-api] Registering OneVice intelligence API routes");

  // Register all OneVice tools so they're available to standard OpenClaw agents too
  const allTools = [...getAllGraphTools(), ...getAllBidTools(), ...getAllFolkTools()];
  for (const tool of allTools) {
    api.registerTool(tool);
  }
  logger.info(`[onevice-api] Registered ${allTools.length} OneVice tools`);

  // POST /onevice/query — Route query to agent orchestrator
  api.registerHttpRoute({
    path: "/onevice/query",
    handler: createQueryHandler(logger),
  });

  // GET /onevice/status — Intelligence system health
  api.registerHttpRoute({
    path: "/onevice/status",
    handler: createStatusHandler(logger),
  });

  // Agent CRUD routes
  // GET /onevice/agents — List user's agents
  // POST /onevice/agents — Create agent
  api.registerHttpRoute({
    path: "/onevice/agents",
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      if (req.method === "GET") {
        return createListAgentsHandler(logger)(req, res);
      }
      if (req.method === "POST") {
        return createCreateAgentHandler(logger)(req, res);
      }
      res.writeHead(405, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Method not allowed" }));
    },
  });

  // Wildcard handler for agent-specific routes
  // PUT /onevice/agents/:id — Update agent
  // DELETE /onevice/agents/:id — Delete agent
  // POST /onevice/agents/:type/query — Direct agent query
  api.registerHttpHandler(async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    const url = req.url ?? "";

    // POST /onevice/agents/:type/query
    if (req.method === "POST" && /^\/onevice\/agents\/[^/]+\/query/.test(url)) {
      await createAgentQueryHandler(logger)(req, res);
      return true;
    }

    // PUT /onevice/agents/:id
    if (req.method === "PUT" && /^\/onevice\/agents\/[^/]+$/.test(url)) {
      await createUpdateAgentHandler(logger)(req, res);
      return true;
    }

    // DELETE /onevice/agents/:id
    if (req.method === "DELETE" && /^\/onevice\/agents\/[^/]+$/.test(url)) {
      await createDeleteAgentHandler(logger)(req, res);
      return true;
    }

    return false; // Not handled — pass to next handler
  });

  logger.info("[onevice-api] Routes registered: /onevice/query, /onevice/status, /onevice/agents/*");
}
