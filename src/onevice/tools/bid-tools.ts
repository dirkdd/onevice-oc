// Bid analysis tools for OneVice intelligence layer
// Ported from backend/app/ai/tools/bid_analysis_tools.py
// Uses native OpenClaw AgentTool pattern with TypeBox schemas

import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { jsonResult, readStringParam, readStringArrayParam } from "../../agents/tools/common.js";
import { executeRead } from "../db/neo4j.js";

// ──────────────────────────────────────────────────────────────────────────────
// 1. validate_line_producer_rate
// ──────────────────────────────────────────────────────────────────────────────

const LineProducerParams = Type.Object({
  bid_id: Type.Optional(Type.String({ description: "Bid ID to analyze (default: bid_mj_v1_2025)" })),
});

export const validateLineProducerRate: AgentTool<typeof LineProducerParams> = {
  name: "validate_line_producer_rate",
  label: "Validate Line Producer Rate",
  description:
    "Validate Line Producer rate against their profile. Checks if the bid rate matches their standard day rate.",
  parameters: LineProducerParams,
  execute: async (_toolCallId, params) => {
    const bidId = readStringParam(params, "bid_id") ?? "bid_mj_v1_2025";

    const query = `
      MATCH (b:Bid {id: $bid_id})
      MATCH (b)-[:HAS_LINE_ITEM]->(li:LineItem {description: 'Line Producer'})
      MATCH (li)-[:ESTIMATES_ROLE]->(p:Person)-[:HAS_PROFILE]->(prof:ProducerProfile)
      RETURN p.fullName AS Talent,
             li.rate AS Bid_Rate,
             prof.dayRate AS Profile_Rate,
             CASE WHEN li.rate = prof.dayRate THEN 'MATCH' ELSE 'MISMATCH' END AS Status
    `;

    try {
      const records = await executeRead<Record<string, unknown>>(query, { bid_id: bidId });

      if (records.length === 0) {
        return jsonResult({
          error: `No Line Producer found for bid ${bidId}`,
          talent: null,
          bid_rate: null,
          profile_rate: null,
          status: "NOT_FOUND",
        });
      }

      const rec = records[0];
      return jsonResult({
        talent: rec.Talent,
        bid_rate: Number(rec.Bid_Rate ?? 0),
        profile_rate: Number(rec.Profile_Rate ?? 0),
        status: rec.Status,
        source: "neo4j_live_data",
      });
    } catch (e) {
      return jsonResult({ error: `Failed to validate Line Producer rate: ${e}`, found: false });
    }
  },
};

// ──────────────────────────────────────────────────────────────────────────────
// 2. get_dp_financial_breakdown
// ──────────────────────────────────────────────────────────────────────────────

const DpParams = Type.Object({
  bid_id: Type.Optional(Type.String({ description: "Bid ID to analyze (default: bid_mj_v1_2025)" })),
});

export const getDpFinancialBreakdown: AgentTool<typeof DpParams> = {
  name: "get_dp_financial_breakdown",
  label: "Get DP Financial Breakdown",
  description:
    "Get Director of Photography financial breakdown including representation, budget phases, line totals, and specialties.",
  parameters: DpParams,
  execute: async (_toolCallId, params) => {
    const bidId = readStringParam(params, "bid_id") ?? "bid_mj_v1_2025";

    const query = `
      MATCH (b:Bid {id: $bid_id})-[:HAS_LINE_ITEM]->(li:LineItem)
      WHERE li.description CONTAINS 'Director Of Photography'
      MATCH (li)-[:ESTIMATES_ROLE]->(p:Person)-[:HAS_PROFILE]->(prof:CinematographerProfile)
      RETURN p.fullName AS Talent,
             prof.agent AS Representation,
             li.category AS Budget_Phase,
             li.total AS Line_Total,
             prof.specialties AS Skills
    `;

    try {
      const records = await executeRead<Record<string, unknown>>(query, { bid_id: bidId });

      if (records.length === 0) {
        return jsonResult({
          error: `No DP found for bid ${bidId}`,
          talent: null,
          representation: null,
          total: 0,
        });
      }

      const talent = records[0].Talent;
      const representation = records[0].Representation;
      const skills = records[0].Skills ?? [];
      const budgetPhases = records.map((r) => r.Budget_Phase);
      const lineTotals = records.map((r) => Number(r.Line_Total ?? 0));

      return jsonResult({
        talent,
        representation,
        budget_phases: budgetPhases,
        line_totals: lineTotals,
        total: lineTotals.reduce((sum, v) => sum + v, 0),
        skills,
        source: "neo4j_live_data",
      });
    } catch (e) {
      return jsonResult({ error: `Failed to get DP breakdown: ${e}`, found: false });
    }
  },
};

// ──────────────────────────────────────────────────────────────────────────────
// 3. get_director_brand_fit
// ──────────────────────────────────────────────────────────────────────────────

const BrandFitParams = Type.Object({
  director_name: Type.String({ description: "Director's full name" }),
  brand_name: Type.String({ description: "Brand/company name" }),
});

export const getDirectorBrandFit: AgentTool<typeof BrandFitParams> = {
  name: "get_director_brand_fit",
  label: "Get Director Brand Fit",
  description:
    "Analyze director's fit for a specific brand campaign. Returns visual style, genres, and previous brand work.",
  parameters: BrandFitParams,
  execute: async (_toolCallId, params) => {
    const directorName = readStringParam(params, "director_name", { required: true });
    const brandName = readStringParam(params, "brand_name", { required: true });

    const query = `
      MATCH (p:Person {fullName: $director_name})-[:HAS_PROFILE]->(prof:DirectorProfile)
      OPTIONAL MATCH (p)-[r:HAS_BRAND_AFFINITY]->(c:Company {name: $brand_name})
      RETURN prof.visualSignature AS Visual_Style,
             prof.topGenres AS Genres,
             r.campaigns AS Previous_Campaigns
    `;

    try {
      const records = await executeRead<Record<string, unknown>>(query, {
        director_name: directorName,
        brand_name: brandName,
      });

      if (records.length === 0) {
        return jsonResult({
          error: `Director ${directorName} not found`,
          visual_style: null,
          genres: [],
          previous_campaigns: [],
        });
      }

      const rec = records[0];
      return jsonResult({
        visual_style: rec.Visual_Style,
        genres: rec.Genres ?? [],
        previous_campaigns: rec.Previous_Campaigns ?? [],
        director: directorName,
        brand: brandName,
        source: "neo4j_live_data",
      });
    } catch (e) {
      return jsonResult({ error: `Failed to analyze director fit: ${e}`, found: false });
    }
  },
};

// ──────────────────────────────────────────────────────────────────────────────
// 4. find_dp_by_aesthetic
// ──────────────────────────────────────────────────────────────────────────────

const AestheticParams = Type.Object({
  project_id: Type.Optional(Type.String({ description: "Project ID (default: proj_mj_spring_25)" })),
  aesthetic_keywords: Type.Optional(
    Type.Array(Type.String(), { description: "Aesthetic keywords to match (default: ['Gritty', 'Grain'])" }),
  ),
});

export const findDpByAesthetic: AgentTool<typeof AestheticParams> = {
  name: "find_dp_by_aesthetic",
  label: "Find DP by Aesthetic",
  description:
    "Find Director of Photography by visual aesthetic requirements like 'Gritty', 'Film Grain', etc.",
  parameters: AestheticParams,
  execute: async (_toolCallId, params) => {
    const projectId = readStringParam(params, "project_id") ?? "proj_mj_spring_25";
    const keywords = readStringArrayParam(params, "aesthetic_keywords") ?? ["Gritty", "Grain"];

    // Build WHERE conditions for aesthetics
    const conditions = keywords.map((_, i) => `prof.visualAesthetic CONTAINS $kw_${i}`).join(" OR ");
    const kwParams: Record<string, unknown> = { project_id: projectId };
    keywords.forEach((kw, i) => {
      kwParams[`kw_${i}`] = kw;
    });

    const query = `
      MATCH (proj:Project {id: $project_id})
      MATCH (proj)<-[:SHOT]-(prof:CinematographerProfile)<-[:HAS_PROFILE]-(p:Person)
      WHERE ${conditions}
      RETURN p.fullName AS DP,
             prof.visualAesthetic AS Aesthetic,
             prof.cameraPreference AS Kit
    `;

    try {
      const records = await executeRead<Record<string, unknown>>(query, kwParams);

      if (records.length === 0) {
        return jsonResult({
          error: `No DP found with aesthetics: ${keywords.join(", ")}`,
          dp: null,
          aesthetic: null,
          camera_preference: null,
        });
      }

      const rec = records[0];
      return jsonResult({
        dp: rec.DP,
        aesthetic: rec.Aesthetic,
        camera_preference: rec.Kit,
        project_id: projectId,
        source: "neo4j_live_data",
      });
    } catch (e) {
      return jsonResult({ error: `Failed to find DP: ${e}`, found: false });
    }
  },
};

// ──────────────────────────────────────────────────────────────────────────────
// 5. check_crew_collaboration
// ──────────────────────────────────────────────────────────────────────────────

const CollabCheckParams = Type.Object({
  person1_name: Type.String({ description: "First person's full name" }),
  person2_name: Type.String({ description: "Second person's full name" }),
});

export const checkCrewCollaboration: AgentTool<typeof CollabCheckParams> = {
  name: "check_crew_collaboration",
  label: "Check Crew Collaboration",
  description:
    "Check if two crew members have worked together before. Useful for validating crew chemistry.",
  parameters: CollabCheckParams,
  execute: async (_toolCallId, params) => {
    const person1 = readStringParam(params, "person1_name", { required: true });
    const person2 = readStringParam(params, "person2_name", { required: true });

    const query = `
      MATCH (p1:Person {fullName: $person1_name})
      MATCH (p2:Person {fullName: $person2_name})
      MATCH (p1)-[r:WORKED_WITH]-(p2)
      RETURN p1.fullName AS Person1,
             r.context AS Relationship_Context,
             p2.fullName AS Person2
    `;

    try {
      const records = await executeRead<Record<string, unknown>>(query, {
        person1_name: person1,
        person2_name: person2,
      });

      if (records.length === 0) {
        return jsonResult({
          person1: person1,
          person2: person2,
          have_worked_together: false,
          relationship_context: null,
          source: "neo4j_live_data",
        });
      }

      const rec = records[0];
      return jsonResult({
        person1: rec.Person1,
        person2: rec.Person2,
        have_worked_together: true,
        relationship_context: rec.Relationship_Context,
        source: "neo4j_live_data",
      });
    } catch (e) {
      return jsonResult({ error: `Failed to check collaboration: ${e}`, found: false });
    }
  },
};

// ──────────────────────────────────────────────────────────────────────────────
// 6. get_executive_producer_for_project
// ──────────────────────────────────────────────────────────────────────────────

const EpParams = Type.Object({
  project_id: Type.Optional(Type.String({ description: "Project ID (default: proj_mj_spring_25)" })),
  bid_id: Type.Optional(Type.String({ description: "Bid ID (default: bid_mj_v1_2025)" })),
});

export const getExecutiveProducerForProject: AgentTool<typeof EpParams> = {
  name: "get_executive_producer_for_project",
  label: "Get Executive Producer",
  description:
    "Find the Executive Producer responsible for a project and its budget.",
  parameters: EpParams,
  execute: async (_toolCallId, params) => {
    const projectId = readStringParam(params, "project_id") ?? "proj_mj_spring_25";
    const bidId = readStringParam(params, "bid_id") ?? "bid_mj_v1_2025";

    const query = `
      MATCH (u:User)-[r1:MANAGES]->(proj:Project {id: $project_id})
      MATCH (u)-[r2:PREPARED]->(bid:Bid {id: $bid_id})
      RETURN u.fullName AS Executive_Producer,
             u.email AS Email,
             r1.role AS Project_Role
    `;

    try {
      const records = await executeRead<Record<string, unknown>>(query, {
        project_id: projectId,
        bid_id: bidId,
      });

      if (records.length === 0) {
        return jsonResult({
          error: `No EP found for project ${projectId} and bid ${bidId}`,
          executive_producer: null,
          email: null,
          project_role: null,
        });
      }

      const rec = records[0];
      return jsonResult({
        executive_producer: rec.Executive_Producer,
        email: rec.Email,
        project_role: rec.Project_Role,
        project_id: projectId,
        bid_id: bidId,
        source: "neo4j_live_data",
      });
    } catch (e) {
      return jsonResult({ error: `Failed to get EP: ${e}`, found: false });
    }
  },
};

// ──────────────────────────────────────────────────────────────────────────────
// 7. analyze_hub_node_status
// ──────────────────────────────────────────────────────────────────────────────

const HubParams = Type.Object({
  company_name: Type.Optional(Type.String({ description: "Company name (default: London Alley)" })),
});

export const analyzeHubNodeStatus: AgentTool<typeof HubParams> = {
  name: "analyze_hub_node_status",
  label: "Analyze Hub Node Status",
  description:
    "Analyze whether a company is a significant hub node in the database. Returns labels and connection count.",
  parameters: HubParams,
  execute: async (_toolCallId, params) => {
    const companyName = readStringParam(params, "company_name") ?? "London Alley";

    const query = `
      MATCH (c:Company {name: $company_name})
      RETURN c.name AS Company,
             labels(c) AS All_Labels,
             c.isHubNode AS Is_Hub,
             size((c)--()) AS Total_Connections
    `;

    try {
      const records = await executeRead<Record<string, unknown>>(query, {
        company_name: companyName,
      });

      if (records.length === 0) {
        return jsonResult({
          error: `Company ${companyName} not found`,
          company: companyName,
          labels: [],
          is_hub: false,
          total_connections: 0,
        });
      }

      const rec = records[0];
      return jsonResult({
        company: rec.Company,
        labels: rec.All_Labels ?? [],
        is_hub: rec.Is_Hub ?? false,
        total_connections: rec.Total_Connections ?? 0,
        source: "neo4j_live_data",
      });
    } catch (e) {
      return jsonResult({ error: `Failed to analyze hub status: ${e}`, found: false });
    }
  },
};

// ──────────────────────────────────────────────────────────────────────────────
// Export all bid tools
// ──────────────────────────────────────────────────────────────────────────────

// oxlint-disable-next-line typescript/no-explicit-any
export function getAllBidTools(): AgentTool<any>[] {
  return [
    validateLineProducerRate,
    getDpFinancialBreakdown,
    getDirectorBrandFit,
    findDpByAesthetic,
    checkCrewCollaboration,
    getExecutiveProducerForProject,
    analyzeHubNodeStatus,
  ];
}
