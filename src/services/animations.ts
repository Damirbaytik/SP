import { supabase } from './supabase.js';
import { redis } from './redis.js';

export interface Animation {
  id: number;
  command: string;
  title: string;
  description: string;
  category: 'love' | 'emotions' | 'communication' | 'fun' | 'premium';
  unlock_type: 'free' | 'premium' | 'referrals';
  unlock_threshold: number;
  emoji: string;
  frames: string[];
  frame_delay_ms: number;
}

const CACHE_KEY = 'animations:all';
const CACHE_TTL = 300; // 5 мин

// In-memory быстрый фильтр команд (обновляется вместе с кэшем)
let commandsSet: Set<string> = new Set();

// Получить все анимации (с кэшем)
export async function getAllAnimations(): Promise<Animation[]> {
  const cached = await redis.get(CACHE_KEY);
  if (cached) {
    const parsed = JSON.parse(cached) as Animation[];
    if (commandsSet.size === 0) {
      commandsSet = new Set(parsed.map((a) => a.command));
    }
    return parsed;
  }

  const { data } = await supabase
    .from('animations')
    .select('*')
    .order('category')
    .order('unlock_type');

  const animations = (data ?? []) as Animation[];
  await redis.set(CACHE_KEY, JSON.stringify(animations), 'EX', CACHE_TTL);
  commandsSet = new Set(animations.map((a) => a.command));
  return animations;
}

// Быстрая проверка (in-memory, без Redis)
export function isAnimationCommand(text: string): boolean {
  return commandsSet.has(text);
}

export async function invalidateAnimationsCache(): Promise<void> {
  await redis.del(CACHE_KEY);
  commandsSet.clear();
}

// Получить анимацию по команде
export async function getAnimation(command: string): Promise<Animation | null> {
  const all = await getAllAnimations();
  return all.find((a) => a.command === command) ?? null;
}

// Проверка доступа пользователя к анимации
export async function hasAnimationAccess(
  userId: number,
  animation: Animation
): Promise<{ allowed: boolean; reason?: string; progress?: { current: number; needed: number } }> {
  if (animation.unlock_type === 'free') {
    return { allowed: true };
  }

  // Получаем данные пользователя
  const { data: user } = await supabase
    .from('users')
    .select('subscription_plan, subscription_expires_at')
    .eq('id', userId)
    .single();

  if (animation.unlock_type === 'premium') {
    const hasActivePro =
      user?.subscription_plan === 'pro' &&
      user?.subscription_expires_at &&
      new Date(user.subscription_expires_at) > new Date();

    return hasActivePro
      ? { allowed: true }
      : { allowed: false, reason: 'premium' };
  }

  if (animation.unlock_type === 'referrals') {
    const { count } = await supabase
      .from('referrals')
      .select('*', { count: 'exact', head: true })
      .eq('referrer_id', userId);

    const current = count ?? 0;
    const needed = animation.unlock_threshold;
    return current >= needed
      ? { allowed: true }
      : { allowed: false, reason: 'referrals', progress: { current, needed } };
  }

  return { allowed: false };
}

export const CATEGORIES = {
  love: { title: 'Любовь', emoji: '❤️' },
  emotions: { title: 'Эмоции', emoji: '🔥' },
  communication: { title: 'Коммуникация', emoji: '💬' },
  fun: { title: 'Развлечения', emoji: '🎮' },
  premium: { title: 'Premium', emoji: '💎' },
} as const;
