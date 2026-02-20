// Graph query tools for OneVice intelligence layer
// Ported from backend/app/ai/tools/graph_tools.py
// Uses native OpenClaw AgentTool pattern with TypeBox schemas

import { Type, type TObject } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { jsonResult, readStringParam, readNumberParam } from "../../agents/tools/common.js";
import { executeRead } from "../db/neo4j.js";
import { cacheGet, cacheSet } from "../db/redis.js";

// Helper: check cache, return parsed JSON or null
async function fromCache(key: string): Promise<unknown | null> {
  try {
    const cached = await cacheGet(key);
    if (cached) return JSON.parse(cached);
  } catch {
    // cache miss or parse error — ignore
  }
  return null;
}

async function toCache(key: string, value: unknown, ttl: number): Promise<void> {
  try {
    await cacheSet(key, JSON.stringify(value), ttl);
  } catch {
    // cache write failure — non-fatal
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// 1. get_person_details
// ──────────────────────────────────────────────────────────────────────────────

const PersonParams = Type.Object({
  name: Type.String({ description: "Person name to search for in the knowledge graph" }),
});

export const getPersonDetails: AgentTool<typeof PersonParams> = {
  name: "get_person_details",
  label: "Get Person Details",
  description:
    "Look up a person in the entertainment industry knowledge graph. Returns profile, projects, organization, groups, and contact owner.",
  parameters: PersonParams,
  execute: async (_toolCallId, params) => {
    const name = readStringParam(params, "name", { required: true });
    const cacheKey = `person_details:${name.toLowerCase().replace(/ /g, "_")}`;

    const cached = await fromCache(cacheKey);
    if (cached) return jsonResult(cached);

    const query = `
      MATCH (p:Person)
      WHERE p.name CONTAINS $name OR p.fullName CONTAINS $name
      OPTIONAL MATCH (p)-[r:CONTRIBUTED_TO]->(proj:Project)
      OPTIONAL MATCH (p)-[:WORKS_FOR]->(org:Organization)
      OPTIONAL MATCH (p)-[:BELONGS_TO]->(g:Group)
      OPTIONAL MATCH (internal:Person {isInternal: true})-[:OWNS_CONTACT]->(p)
      RETURN p {
        .name, .fullName, .email, .folkId, .isInternal,
        .bio, .role, .phone, .location, .linkedinUrl, .website, .tags
      } AS person,
      org.name AS organization,
      collect(DISTINCT {
        project: proj.name,
        role: r.role,
        startDate: r.startDate,
        projectId: proj.id
      }) AS projects,
      collect(DISTINCT g.name) AS groups,
      internal.name AS contact_owner
    `;

    try {
      const records = await executeRead<Record<string, unknown>>(query, { name });

      if (records.length > 0) {
        const rec = records[0];
        const projects = (rec.projects as Array<Record<string, unknown>>).filter(
          (p) => p.project,
        );
        const groups = (rec.groups as string[]).filter(Boolean);

        const response = {
          person: rec.person,
          organization: rec.organization,
          projects,
          groups,
          contact_owner: rec.contact_owner,
          query: name,
          found: true,
        };

        await toCache(cacheKey, response, 300);
        return jsonResult(response);
      }

      return jsonResult({
        person: null,
        organization: null,
        projects: [],
        groups: [],
        contact_owner: null,
        query: name,
        found: false,
        error: "Person not found in knowledge graph",
      });
    } catch (e) {
      return jsonResult({ error: `Query failed: ${e}`, query: name, found: false });
    }
  },
};

// ──────────────────────────────────────────────────────────────────────────────
// 2. get_organization_profile
// ──────────────────────────────────────────────────────────────────────────────

const OrgParams = Type.Object({
  name: Type.String({ description: "Organization name to look up" }),
});

export const getOrganizationProfile: AgentTool<typeof OrgParams> = {
  name: "get_organization_profile",
  label: "Get Organization Profile",
  description:
    "Get comprehensive organization profile including people, projects, and deals from the knowledge graph.",
  parameters: OrgParams,
  execute: async (_toolCallId, params) => {
    const orgName = readStringParam(params, "name", { required: true });
    const cacheKey = `org_profile:${orgName.toLowerCase().replace(/ /g, "_")}`;

    const cached = await fromCache(cacheKey);
    if (cached) return jsonResult(cached);

    const query = `
      MATCH (o:Organization)
      WHERE o.id CONTAINS $org_name OR o.name CONTAINS $org_name OR
            toLower(o.id) CONTAINS toLower($org_name) OR toLower(o.name) CONTAINS toLower($org_name)
      OPTIONAL MATCH (o)<-[:WORKS_FOR]-(p:Person)
      OPTIONAL MATCH (o)<-[:FOR_CLIENT]-(proj:Project)
      OPTIONAL MATCH (o)<-[:FOR_ORGANIZATION]-(d:Deal)
      RETURN o {
        .id, .name, .type, .description, .folkId
      } AS organization,
      collect(DISTINCT p.name) AS people,
      collect(DISTINCT proj.name) AS projects,
      collect(DISTINCT d.name) AS deals,
      count(DISTINCT p) AS people_count,
      count(DISTINCT proj) AS project_count
    `;

    try {
      const records = await executeRead<Record<string, unknown>>(query, { org_name: orgName });

      if (records.length > 0) {
        const rec = records[0];
        const orgData = rec.organization as Record<string, unknown>;
        const displayName = (orgData?.name as string) || (orgData?.id as string) || "Unknown Organization";

        const response = {
          organization: { ...orgData, display_name: displayName },
          people: (rec.people as string[]).filter(Boolean),
          projects: (rec.projects as string[]).filter(Boolean),
          deals: (rec.deals as string[]).filter(Boolean),
          stats: {
            people_count: rec.people_count,
            project_count: rec.project_count,
          },
          query: orgName,
          found: true,
        };

        await toCache(cacheKey, response, 600);
        return jsonResult(response);
      }

      return jsonResult({
        organization: null,
        people: [],
        projects: [],
        deals: [],
        stats: { people_count: 0, project_count: 0 },
        query: orgName,
        found: false,
        error: "Organization not found",
      });
    } catch (e) {
      return jsonResult({ error: `Query failed: ${e}`, query: orgName, found: false });
    }
  },
};

// ──────────────────────────────────────────────────────────────────────────────
// 3. find_collaborators
// ──────────────────────────────────────────────────────────────────────────────

const CollabParams = Type.Object({
  person_name: Type.String({ description: "Person to find collaborators for" }),
  project_type: Type.Optional(Type.String({ description: "Optional project type filter" })),
});

export const findCollaborators: AgentTool<typeof CollabParams> = {
  name: "find_collaborators",
  label: "Find Collaborators",
  description:
    "Find people who have collaborated with a specific person on projects, optionally filtered by project type.",
  parameters: CollabParams,
  execute: async (_toolCallId, params) => {
    const personName = readStringParam(params, "person_name", { required: true });
    const projectType = readStringParam(params, "project_type");
    const cacheKey = `collaborators:${personName.toLowerCase().replace(/ /g, "_")}:${projectType ?? "all"}`;

    const cached = await fromCache(cacheKey);
    if (cached) return jsonResult(cached);

    let query = `
      MATCH (p1:Person)-[:CONTRIBUTED_TO]->(proj:Project)<-[:CONTRIBUTED_TO]-(p2:Person)
      WHERE p1.name CONTAINS $person_name AND p1 <> p2
    `;

    const queryParams: Record<string, unknown> = { person_name: personName };

    if (projectType) {
      query += ` AND proj.type CONTAINS $project_type`;
      queryParams.project_type = projectType;
    }

    query += `
      WITH p2, collect(DISTINCT proj.name) AS shared_projects, count(DISTINCT proj) AS collaboration_count
      ORDER BY collaboration_count DESC
      LIMIT 20
      RETURN p2 {
        .name, .role, .email, .folkId
      } AS collaborator,
      shared_projects,
      collaboration_count
    `;

    try {
      const records = await executeRead<Record<string, unknown>>(query, queryParams);

      const collaborators = records.map((rec) => ({
        collaborator: rec.collaborator,
        shared_projects: rec.shared_projects,
        collaboration_count: rec.collaboration_count,
      }));

      const response = {
        collaborators,
        person: personName,
        project_type: projectType ?? null,
        count: collaborators.length,
        found: collaborators.length > 0,
      };

      await toCache(cacheKey, response, 300);
      return jsonResult(response);
    } catch (e) {
      return jsonResult({ error: `Query failed: ${e}`, person: personName, found: false });
    }
  },
};

// ──────────────────────────────────────────────────────────────────────────────
// 4. get_project_details
// ──────────────────────────────────────────────────────────────────────────────

const ProjectParams = Type.Object({
  title: Type.String({ description: "Project title to search for" }),
});

export const getProjectDetails: AgentTool<typeof ProjectParams> = {
  name: "get_project_details",
  label: "Get Project Details",
  description:
    "Get comprehensive project information including crew, creative concepts, client, and department.",
  parameters: ProjectParams,
  execute: async (_toolCallId, params) => {
    const title = readStringParam(params, "title", { required: true });
    const cacheKey = `project_details:${title.toLowerCase().replace(/ /g, "_")}`;

    const cached = await fromCache(cacheKey);
    if (cached) return jsonResult(cached);

    const query = `
      MATCH (proj:Project)
      WHERE proj.name CONTAINS $title
      OPTIONAL MATCH (proj)-[:FOR_CLIENT]->(client:Organization)
      OPTIONAL MATCH (proj)-[:FEATURES_CONCEPT]->(c:CreativeConcept)
      OPTIONAL MATCH (p:Person)-[r:CONTRIBUTED_TO]->(proj)
      OPTIONAL MATCH (proj)-[:MANAGED_BY]->(dept:Department)
      RETURN proj {
        .name, .id, .logline, .status, .year, .description
      } AS project,
      client.name AS client,
      dept.name AS department,
      collect(DISTINCT c.name) AS concepts,
      collect(DISTINCT {
        person: p.name,
        role: r.role,
        startDate: r.startDate
      }) AS crew
    `;

    try {
      const records = await executeRead<Record<string, unknown>>(query, { title });

      if (records.length > 0) {
        const rec = records[0];
        const crew = (rec.crew as Array<Record<string, unknown>>).filter((c) => c.person);
        const concepts = (rec.concepts as string[]).filter(Boolean);

        const response = {
          project: rec.project,
          client: rec.client,
          department: rec.department,
          concepts,
          crew,
          crew_count: crew.length,
          found: true,
        };

        await toCache(cacheKey, response, 300);
        return jsonResult(response);
      }

      return jsonResult({
        project: null,
        found: false,
        error: "Project not found in knowledge graph",
      });
    } catch (e) {
      return jsonResult({ error: `Query failed: ${e}`, project_title: title, found: false });
    }
  },
};

// ──────────────────────────────────────────────────────────────────────────────
// 5. find_similar_projects
// ──────────────────────────────────────────────────────────────────────────────

const SimilarParams = Type.Object({
  title: Type.String({ description: "Project title to find similar projects for" }),
  threshold: Type.Optional(
    Type.Number({ description: "Cosine similarity threshold (0-1, default 0.8)" }),
  ),
});

export const findSimilarProjects: AgentTool<typeof SimilarParams> = {
  name: "find_similar_projects",
  label: "Find Similar Projects",
  description:
    "Find projects similar to a given project using vector similarity on concept embeddings.",
  parameters: SimilarParams,
  execute: async (_toolCallId, params) => {
    const title = readStringParam(params, "title", { required: true });
    const threshold = readNumberParam(params, "threshold") ?? 0.8;
    const cacheKey = `similar_projects:${title.toLowerCase().replace(/ /g, "_")}:${threshold}`;

    const cached = await fromCache(cacheKey);
    if (cached) return jsonResult(cached);

    // Step 1: get target project embedding
    const targetQuery = `
      MATCH (proj:Project)
      WHERE proj.name CONTAINS $title
      RETURN proj.concept_embedding AS embedding, proj.name AS exact_title
      LIMIT 1
    `;

    try {
      const targetRecords = await executeRead<Record<string, unknown>>(targetQuery, { title });

      if (targetRecords.length === 0) {
        return jsonResult({
          similar_projects: [],
          target_project: title,
          error: "Target project not found or no embedding available",
          found: false,
        });
      }

      const targetEmbedding = targetRecords[0].embedding;
      const exactTitle = targetRecords[0].exact_title as string;

      if (!targetEmbedding) {
        return jsonResult({
          similar_projects: [],
          target_project: title,
          error: "Target project has no concept embedding",
          found: false,
        });
      }

      // Step 2: find similar via cosine similarity
      const simQuery = `
        MATCH (proj:Project)
        WHERE proj.concept_embedding IS NOT NULL
        AND proj.name <> $exact_title
        WITH proj, gds.similarity.cosine(proj.concept_embedding, $target_embedding) AS similarity
        WHERE similarity >= $threshold
        OPTIONAL MATCH (proj)-[:FOR_CLIENT]->(client:Organization)
        RETURN proj {
          .name, .type, .year, .status
        } AS project,
        client.name AS client,
        similarity
        ORDER BY similarity DESC
        LIMIT 10
      `;

      const records = await executeRead<Record<string, unknown>>(simQuery, {
        exact_title: exactTitle,
        target_embedding: targetEmbedding,
        threshold,
      });

      const similarProjects = records.map((rec) => ({
        project: rec.project,
        client: rec.client,
        similarity_score: rec.similarity,
      }));

      const response = {
        similar_projects: similarProjects,
        target_project: exactTitle,
        similarity_threshold: threshold,
        count: similarProjects.length,
        found: similarProjects.length > 0,
      };

      await toCache(cacheKey, response, 300);
      return jsonResult(response);
    } catch (e) {
      return jsonResult({ error: `Query failed: ${e}`, target_project: title, found: false });
    }
  },
};

// ──────────────────────────────────────────────────────────────────────────────
// 6. broad_vector_search (text-matching across node types)
// ──────────────────────────────────────────────────────────────────────────────

const SearchParams = Type.Object({
  query: Type.String({ description: "Search query to match across persons, projects, organizations, and documents" }),
  limit: Type.Optional(Type.Number({ description: "Max results per node type (default 5)" })),
});

export const broadVectorSearch: AgentTool<typeof SearchParams> = {
  name: "broad_vector_search",
  label: "Broad Knowledge Search",
  description:
    "Search across Person, Project, Organization, and Document nodes using text matching. Returns combined results from all node types.",
  parameters: SearchParams,
  execute: async (_toolCallId, params) => {
    const query = readStringParam(params, "query", { required: true });
    const limit = readNumberParam(params, "limit", { integer: true }) ?? 5;

    const searchQueries = [
      {
        label: "persons",
        cypher: `
          MATCH (p:Person)
          WHERE p.name CONTAINS $query OR p.fullName CONTAINS $query OR p.bio CONTAINS $query
          RETURN p { .name, .fullName, .role, .bio } AS result, 'Person' AS type
          LIMIT $limit
        `,
      },
      {
        label: "projects",
        cypher: `
          MATCH (p:Project)
          WHERE p.name CONTAINS $query OR p.description CONTAINS $query OR p.logline CONTAINS $query
          RETURN p { .name, .type, .year, .status, .description } AS result, 'Project' AS type
          LIMIT $limit
        `,
      },
      {
        label: "organizations",
        cypher: `
          MATCH (o:Organization)
          WHERE o.name CONTAINS $query OR o.description CONTAINS $query
          RETURN o { .name, .type, .description } AS result, 'Organization' AS type
          LIMIT $limit
        `,
      },
      {
        label: "documents",
        cypher: `
          MATCH (d:Document)
          WHERE d.title CONTAINS $query OR d.content CONTAINS $query
          RETURN d { .title, .type, .id } AS result, 'Document' AS type
          LIMIT $limit
        `,
      },
    ];

    try {
      const allResults: Array<{ result: unknown; type: string; category: string }> = [];

      // Run all queries in parallel
      const promises = searchQueries.map(async (sq) => {
        try {
          const records = await executeRead<Record<string, unknown>>(sq.cypher, { query, limit });
          return records.map((rec) => ({
            result: rec.result,
            type: rec.type as string,
            category: sq.label,
          }));
        } catch {
          return [];
        }
      });

      const resultArrays = await Promise.all(promises);
      for (const arr of resultArrays) {
        allResults.push(...arr);
      }

      return jsonResult({
        results: allResults,
        query,
        total_count: allResults.length,
        by_type: {
          persons: allResults.filter((r) => r.category === "persons").length,
          projects: allResults.filter((r) => r.category === "projects").length,
          organizations: allResults.filter((r) => r.category === "organizations").length,
          documents: allResults.filter((r) => r.category === "documents").length,
        },
        found: allResults.length > 0,
      });
    } catch (e) {
      return jsonResult({ error: `Search failed: ${e}`, query, found: false });
    }
  },
};

// ──────────────────────────────────────────────────────────────────────────────
// Export all graph tools
// ──────────────────────────────────────────────────────────────────────────────

// oxlint-disable-next-line typescript/no-explicit-any
export function getAllGraphTools(): AgentTool<any>[] {
  return [
    getPersonDetails,
    getOrganizationProfile,
    findCollaborators,
    getProjectDetails,
    findSimilarProjects,
    broadVectorSearch,
  ];
}
