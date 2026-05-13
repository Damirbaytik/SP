import { redis } from './redis.js';
import { supabase } from './supabase.js';

const OWNER_TTL = 86400; // 24ч

export async function getConnectionOwner(connectionId: string): Promise<number | null> {
  const key = `bc_owner:${connectionId}`;
  const cached = await redis.get(key);
  if (cached) return parseInt(cached);

  const { data } = await supabase
    .from('business_connections')
    .select('user_id')
    .eq('id', connectionId)
    .single();

  if (!data) return null;
  await redis.set(key, String(data.user_id), 'EX', OWNER_TTL);
  return data.user_id;
}

export async function invalidateConnectionOwner(connectionId: string): Promise<void> {
  await redis.del(`bc_owner:${connectionId}`);
}
