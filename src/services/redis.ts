import Redis from 'ioredis';
import { config } from '../config.js';

export const redis = new Redis(config.redis.url);

redis.on('error', (err) => {
  console.error('[Redis] Connection error:', err.message);
});

redis.on('connect', () => {
  console.log('[Redis] Connected');
});
