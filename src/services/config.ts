import { supabase } from './supabase.js';
import { redis } from './redis.js';

const CACHE_TTL = 300; // 5 мин

export async function getConfig<T = unknown>(key: string, defaultValue: T): Promise<T> {
  const cacheKey = `cfg:${key}`;
  const cached = await redis.get(cacheKey);
  if (cached) return JSON.parse(cached);

  const { data } = await supabase
    .from('bot_config')
    .select('value')
    .eq('key', key)
    .single();

  const value = (data?.value as T) ?? defaultValue;
  await redis.set(cacheKey, JSON.stringify(value), 'EX', CACHE_TTL);
  return value;
}

export async function invalidateConfig(key: string): Promise<void> {
  await redis.del(`cfg:${key}`);
}
