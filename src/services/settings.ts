import { redis } from './redis.js';
import { supabase } from './supabase.js';

export interface UserSettings {
  spy_enabled: boolean;
  notify_edited: boolean;
  notify_deleted: boolean;
  notify_timer_media: boolean;
  animations_enabled: boolean;
  streaks_enabled: boolean;
}

const SETTINGS_TTL = 300; // 5 минут

const DEFAULT_SETTINGS: UserSettings = {
  spy_enabled: true,
  notify_edited: true,
  notify_deleted: true,
  notify_timer_media: true,
  animations_enabled: true,
  streaks_enabled: true,
};

export async function getUserSettings(userId: number): Promise<UserSettings> {
  const key = `settings:${userId}`;
  const cached = await redis.get(key);
  if (cached) return JSON.parse(cached);

  const { data } = await supabase
    .from('user_settings')
    .select('spy_enabled, notify_edited, notify_deleted, notify_timer_media, animations_enabled, streaks_enabled')
    .eq('user_id', userId)
    .single();

  const settings: UserSettings = data ?? DEFAULT_SETTINGS;
  await redis.set(key, JSON.stringify(settings), 'EX', SETTINGS_TTL);
  return settings;
}

export async function invalidateSettings(userId: number): Promise<void> {
  await redis.del(`settings:${userId}`);
}
