// Agent configurations for OneVice intelligence layer
// Defines system prompts and tool subsets for each agent type
// Replaces LangGraph StateGraph nodes with simple config objects

import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { AgentType } from "../types/index.js";
import {
  getPersonDetails,
  getOrganizationProfile,
  findCollaborators,
  getProjectDetails,
  findSimilarProjects,
  broadVectorSearch,
} from "../tools/graph-tools.js";
import {
  validateLineProducerRate,
  getDpFinancialBreakdown,
  getDirectorBrandFit,
  findDpByAesthetic,
  checkCrewCollaboration,
  getExecutiveProducerForProject,
  analyzeHubNodeStatus,
} from "../tools/bid-tools.js";
import { searchFolkContacts, getFolkContactDetails, listFolkGroups } from "../tools/folk-crm.js";

export type AgentConfig = {
  type: AgentType;
  systemPrompt: string;
  // oxlint-disable-next-line typescript/no-explicit-any
  tools: AgentTool<any>[];
  defaultModel?: string;
};

// ──────────────────────────────────────────────────────────────────────────────
// Agent configs
// ──────────────────────────────────────────────────────────────────────────────

export const SALES_CONFIG: AgentConfig = {
  type: "sales",
  systemPrompt: `You are the OneVice Sales Intelligence Agent, an AI assistant for the entertainment industry.

Your capabilities:
- Look up people, organizations, and their relationships in the knowledge graph
- Search Folk CRM for live contact data
- Find collaborators and network connections
- Search across the entire knowledge base

When answering:
- Be concise and actionable
- Include specific names, roles, and relationships
- Suggest next steps when appropriate
- If data is not found, suggest alternative search approaches`,
  tools: [
    getPersonDetails,
    getOrganizationProfile,
    findCollaborators,
    broadVectorSearch,
    searchFolkContacts,
    getFolkContactDetails,
    listFolkGroups,
  ],
};

export const TALENT_CONFIG: AgentConfig = {
  type: "talent",
  systemPrompt: `You are the OneVice Talent Acquisition Agent, an AI assistant for finding and evaluating entertainment industry talent.

Your capabilities:
- Search for people by skills, roles, and experience
- Find collaborators and past working relationships
- Look up project details and crew compositions
- Find similar projects for pattern matching
- Check crew collaboration history

When answering:
- Focus on relevant experience and skills
- Highlight collaboration history between crew members
- Suggest talent based on project requirements
- Note any potential scheduling or availability concerns`,
  tools: [
    getPersonDetails,
    findCollaborators,
    getProjectDetails,
    findSimilarProjects,
    broadVectorSearch,
    checkCrewCollaboration,
    findDpByAesthetic,
    getDirectorBrandFit,
  ],
};

export const BIDDING_CONFIG: AgentConfig = {
  type: "bidding",
  systemPrompt: `You are the OneVice Bidding Intelligence Agent, an AI assistant for analyzing bids, budgets, and production costs.

Your capabilities:
- Validate talent rates against profiles
- Get financial breakdowns for crew positions
- Analyze director-brand fit for campaigns
- Find DPs by visual aesthetic requirements
- Check crew collaboration history
- Identify executive producers for projects
- Analyze company hub status in the network

When answering:
- Provide specific numbers and rates
- Flag mismatches between bid rates and profile rates
- Suggest cost optimizations when appropriate
- Reference relevant past projects for comparison`,
  tools: [
    validateLineProducerRate,
    getDpFinancialBreakdown,
    getDirectorBrandFit,
    findDpByAesthetic,
    checkCrewCollaboration,
    getExecutiveProducerForProject,
    analyzeHubNodeStatus,
    getProjectDetails,
    getPersonDetails,
    broadVectorSearch,
  ],
};

// ──────────────────────────────────────────────────────────────────────────────
// Config lookup
// ──────────────────────────────────────────────────────────────────────────────

const CONFIGS: Record<string, AgentConfig> = {
  sales: SALES_CONFIG,
  talent: TALENT_CONFIG,
  bidding: BIDDING_CONFIG,
};

export function getAgentConfig(type: AgentType): AgentConfig {
  return CONFIGS[type] ?? SALES_CONFIG; // default to sales for "custom" or unknown
}

// ──────────────────────────────────────────────────────────────────────────────
// Query classification
// ──────────────────────────────────────────────────────────────────────────────

const SALES_KEYWORDS = [
  "lead", "client", "company", "organization", "deal", "pipeline",
  "contact", "revenue", "prospect", "sales", "crm", "folk",
];

const TALENT_KEYWORDS = [
  "crew", "talent", "director", "producer", "dp", "casting",
  "hire", "skill", "cinematographer", "editor", "writer",
];

const BIDDING_KEYWORDS = [
  "bid", "cost", "rate", "budget", "estimate", "vendor",
  "financial", "breakdown", "price", "fee", "invoice", "line item",
];

export function classifyQuery(message: string): AgentType {
  const lower = message.toLowerCase();

  let salesScore = 0;
  let talentScore = 0;
  let biddingScore = 0;

  for (const kw of SALES_KEYWORDS) {
    if (lower.includes(kw)) salesScore++;
  }
  for (const kw of TALENT_KEYWORDS) {
    if (lower.includes(kw)) talentScore++;
  }
  for (const kw of BIDDING_KEYWORDS) {
    if (lower.includes(kw)) biddingScore++;
  }

  if (biddingScore > salesScore && biddingScore > talentScore) return "bidding";
  if (talentScore > salesScore) return "talent";
  if (salesScore > 0) return "sales";

  // Default to sales for general queries
  return "sales";
}
