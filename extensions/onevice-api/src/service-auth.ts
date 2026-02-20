import type { IncomingMessage, ServerResponse } from "node:http";

const SERVICE_KEY = process.env.ONEVICE_SERVICE_KEY ?? "";

export type UserContext = {
  user_id: string;
  role: string;
  data_sensitivity: number;
  department?: string;
};

export function validateServiceKey(req: IncomingMessage): boolean {
  if (!SERVICE_KEY) return false;
  const header = req.headers["x-service-key"];
  if (typeof header !== "string") return false;
  // Constant-time comparison
  if (header.length !== SERVICE_KEY.length) return false;
  let mismatch = 0;
  for (let i = 0; i < header.length; i++) {
    mismatch |= header.charCodeAt(i) ^ SERVICE_KEY.charCodeAt(i);
  }
  return mismatch === 0;
}

export function parseUserContext(req: IncomingMessage): UserContext | null {
  const raw = req.headers["x-user-context"];
  if (typeof raw !== "string") return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed.user_id || !parsed.role) return null;
    return {
      user_id: parsed.user_id,
      role: parsed.role,
      data_sensitivity: parsed.data_sensitivity ?? 1,
      department: parsed.department,
    };
  } catch {
    return null;
  }
}

export function getUserIdFromRequest(req: IncomingMessage): string | null {
  const ctx = parseUserContext(req);
  if (ctx?.user_id) return ctx.user_id;
  const header = req.headers["x-user-id"];
  if (typeof header === "string" && header.length > 0) return header;
  return null;
}

export function sendUnauthorized(res: ServerResponse, message = "Unauthorized"): void {
  res.writeHead(401, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: message }));
}

export function sendJson(res: ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

export function sendError(res: ServerResponse, message: string, status = 500): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: message }));
}

export async function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

export async function readJsonBody<T = unknown>(req: IncomingMessage): Promise<T | null> {
  try {
    const text = await readBody(req);
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}
