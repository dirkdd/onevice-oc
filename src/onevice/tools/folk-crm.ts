// Folk CRM tools for OneVice intelligence layer
// HTTP-based integration with Folk API (https://api.folk.app/v1)
// Uses dual API keys (FOLK_API_KEY_1 / FOLK_API_KEY_2) for multi-account access

import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { jsonResult, readStringParam, readNumberParam } from "../../agents/tools/common.js";

const FOLK_BASE_URL = "https://api.folk.app/v1";

function getFolkApiKeys(): string[] {
  const keys: string[] = [];
  const k1 = process.env.FOLK_API_KEY_1;
  const k2 = process.env.FOLK_API_KEY_2;
  if (k1) keys.push(k1);
  if (k2) keys.push(k2);
  return keys;
}

async function folkFetch(path: string, apiKey: string): Promise<unknown> {
  const res = await fetch(`${FOLK_BASE_URL}${path}`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) {
    throw new Error(`Folk API ${res.status}: ${res.statusText}`);
  }
  return res.json();
}

// Try all available API keys, return first success
async function folkFetchMultiKey(path: string): Promise<unknown> {
  const keys = getFolkApiKeys();
  if (keys.length === 0) {
    throw new Error("No FOLK_API_KEY configured (set FOLK_API_KEY_1 or FOLK_API_KEY_2)");
  }

  let lastError: Error | null = null;
  for (const key of keys) {
    try {
      return await folkFetch(path, key);
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
    }
  }
  throw lastError ?? new Error("Folk API request failed");
}

// ──────────────────────────────────────────────────────────────────────────────
// 1. search_folk_contacts
// ──────────────────────────────────────────────────────────────────────────────

const SearchContactsParams = Type.Object({
  query: Type.String({ description: "Name or email to search for in Folk CRM" }),
  limit: Type.Optional(Type.Number({ description: "Max results to return (default 10)" })),
});

export const searchFolkContacts: AgentTool<typeof SearchContactsParams> = {
  name: "search_folk_contacts",
  label: "Search Folk Contacts",
  description:
    "Search for contacts in Folk CRM by name or email. Returns matching contact profiles.",
  parameters: SearchContactsParams,
  execute: async (_toolCallId, params) => {
    const query = readStringParam(params, "query", { required: true });
    const limit = readNumberParam(params, "limit", { integer: true }) ?? 10;

    try {
      const data = (await folkFetchMultiKey(
        `/people?search=${encodeURIComponent(query)}&limit=${limit}`,
      )) as { data?: unknown[]; items?: unknown[] };

      const contacts = data.data ?? data.items ?? [];

      return jsonResult({
        contacts,
        query,
        count: (contacts as unknown[]).length,
        found: (contacts as unknown[]).length > 0,
        source: "folk_crm",
      });
    } catch (e) {
      return jsonResult({
        error: `Folk search failed: ${e}`,
        query,
        found: false,
      });
    }
  },
};

// ──────────────────────────────────────────────────────────────────────────────
// 2. get_folk_contact_details
// ──────────────────────────────────────────────────────────────────────────────

const ContactDetailsParams = Type.Object({
  contact_id: Type.String({ description: "Folk contact ID to retrieve" }),
});

export const getFolkContactDetails: AgentTool<typeof ContactDetailsParams> = {
  name: "get_folk_contact_details",
  label: "Get Folk Contact Details",
  description:
    "Get full contact profile from Folk CRM by contact ID. Includes all custom fields and tags.",
  parameters: ContactDetailsParams,
  execute: async (_toolCallId, params) => {
    const contactId = readStringParam(params, "contact_id", { required: true });

    try {
      const data = await folkFetchMultiKey(`/people/${contactId}`);

      return jsonResult({
        contact: data,
        contact_id: contactId,
        found: true,
        source: "folk_crm",
      });
    } catch (e) {
      return jsonResult({
        error: `Folk contact lookup failed: ${e}`,
        contact_id: contactId,
        found: false,
      });
    }
  },
};

// ──────────────────────────────────────────────────────────────────────────────
// 3. list_folk_groups
// ──────────────────────────────────────────────────────────────────────────────

const ListGroupsParams = Type.Object({
  limit: Type.Optional(Type.Number({ description: "Max groups to return (default 20)" })),
});

export const listFolkGroups: AgentTool<typeof ListGroupsParams> = {
  name: "list_folk_groups",
  label: "List Folk Groups",
  description:
    "List all groups (lists) in Folk CRM. Groups organize contacts into categories.",
  parameters: ListGroupsParams,
  execute: async (_toolCallId, params) => {
    const limit = readNumberParam(params, "limit", { integer: true }) ?? 20;

    try {
      const data = (await folkFetchMultiKey(`/groups?limit=${limit}`)) as {
        data?: unknown[];
        items?: unknown[];
      };

      const groups = data.data ?? data.items ?? [];

      return jsonResult({
        groups,
        count: (groups as unknown[]).length,
        found: (groups as unknown[]).length > 0,
        source: "folk_crm",
      });
    } catch (e) {
      return jsonResult({
        error: `Folk groups listing failed: ${e}`,
        found: false,
      });
    }
  },
};

// ──────────────────────────────────────────────────────────────────────────────
// Export all Folk CRM tools
// ──────────────────────────────────────────────────────────────────────────────

// oxlint-disable-next-line typescript/no-explicit-any
export function getAllFolkTools(): AgentTool<any>[] {
  return [searchFolkContacts, getFolkContactDetails, listFolkGroups];
}
