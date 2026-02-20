// Neo4j client for OneVice intelligence layer
// Connects to Neo4j Aura for graph queries (persons, orgs, projects, collaborations)

import neo4j, { type Driver, type Session, type Result } from "neo4j-driver";

let driver: Driver | null = null;

export function getDriver(): Driver {
  if (driver) return driver;

  const uri = process.env.NEO4J_URI;
  const username = process.env.NEO4J_USERNAME ?? "neo4j";
  const password = process.env.NEO4J_PASSWORD;

  if (!uri || !password) {
    throw new Error("NEO4J_URI and NEO4J_PASSWORD must be set");
  }

  // neo4j-driver v5.28.x: no max_retry_time, no encrypted with neo4j+s://
  driver = neo4j.driver(uri, neo4j.auth.basic(username, password));
  return driver;
}

export function getSession(database?: string): Session {
  return getDriver().session({
    database: database ?? process.env.NEO4J_DATABASE ?? "neo4j",
  });
}

export async function executeRead<T>(
  query: string,
  params?: Record<string, unknown>,
): Promise<T[]> {
  const session = getSession();
  try {
    const result: Result = await session.executeRead((tx) =>
      tx.run(query, params),
    );
    return result.records.map((r) => r.toObject() as T);
  } finally {
    await session.close();
  }
}

export async function executeWrite<T>(
  query: string,
  params?: Record<string, unknown>,
): Promise<T[]> {
  const session = getSession();
  try {
    const result: Result = await session.executeWrite((tx) =>
      tx.run(query, params),
    );
    return result.records.map((r) => r.toObject() as T);
  } finally {
    await session.close();
  }
}

export async function verifyConnection(): Promise<boolean> {
  try {
    const session = getSession();
    const result = await session.run("RETURN 1 AS test");
    const records = result.records;
    await session.close();
    return records.length > 0 && records[0].get("test").toNumber() === 1;
  } catch {
    return false;
  }
}

export async function closeDriver(): Promise<void> {
  if (driver) {
    await driver.close();
    driver = null;
  }
}
