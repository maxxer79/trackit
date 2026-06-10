import Redis from 'ioredis';

/**
 * Prefers discrete REDIS_HOST/PORT/PASSWORD env vars over REDIS_URL —
 * passwords with special characters (@ : / # ?) break URL parsing.
 */
function redisConfig() {
  if (process.env.REDIS_HOST) {
    return {
      host: process.env.REDIS_HOST,
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD || undefined,
    };
  }
  const url = process.env.REDIS_URL || 'redis://localhost:6379';
  try {
    const u = new URL(url);
    return {
      host: u.hostname || 'localhost',
      port: parseInt(u.port || '6379'),
      password: u.password ? decodeURIComponent(u.password) : undefined,
    };
  } catch {
    return { host: 'localhost', port: 6379, password: undefined };
  }
}

export const redis = new Redis({
  ...redisConfig(),
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

redis.on('connect', () => {
  console.log('✅ Redis connected');
});

redis.on('error', (err) => {
  console.error('❌ Redis error:', err);
});

export default redis;
