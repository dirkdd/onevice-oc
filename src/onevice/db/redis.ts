// Redis client for OneVice intelligence layer
// Used for caching, rate limiting, and session state

import Redis from "ioredis";

const KEY_PREFIX = "onevice:";
let client: Redis | null = null;

export function getRedisClient(): Redis {
  if (client) return client;

  const url = process.env.REDIS_URL;
  if (url) {
    client = new Redis(url, { keyPrefix: KEY_PREFIX, lazyConnect: true });
  } else {
    const host = process.env.REDIS_HOST ?? "localhost";
    const port = parseInt(process.env.REDIS_PORT ?? "6379", 10);
    const password = process.env.REDIS_PASSWORD;

    client = new Redis({
      host,
      port,
      password: password || undefined,
      keyPrefix: KEY_PREFIX,
      lazyConnect: true,
    });
  }

  return client;
}

export async function cacheGet(key: string): Promise<string | null> {
  const redis = getRedisClient();
  return redis.get(key);
}

export async function cacheSet(
  key: string,
  value: string,
  ttlSeconds = 300,
): Promise<void> {
  const redis = getRedisClient();
  await redis.set(key, value, "EX", ttlSeconds);
}

export async function cacheDel(key: string): Promise<void> {
  const redis = getRedisClient();
  await redis.del(key);
}

export async function verifyConnection(): Promise<boolean> {
  try {
    const redis = getRedisClient();
    await redis.connect();
    const pong = await redis.ping();
    return pong === "PONG";
  } catch {
    return false;
  }
}

export async function closeClient(): Promise<void> {
  if (client) {
    await client.quit();
    client = null;
  }
}
