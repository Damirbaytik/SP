import { supabase } from './supabase.js';
import { redis } from './redis.js';
import { getConfig } from './config.js';

export interface Plan {
  id: number;
  code: string;
  title: string;
  days: number;
  price_stars: number;
  price_rub: number;
  is_active: boolean;
  sort_order: number;
}

const PLANS_CACHE_KEY = 'plans:active';
const PLANS_TTL = 300;

export async function getActivePlans(): Promise<Plan[]> {
  const cached = await redis.get(PLANS_CACHE_KEY);
  if (cached) return JSON.parse(cached);

  const { data } = await supabase
    .from('subscription_plans')
    .select('*')
    .eq('is_active', true)
    .order('sort_order');

  const plans = (data ?? []) as Plan[];
  await redis.set(PLANS_CACHE_KEY, JSON.stringify(plans), 'EX', PLANS_TTL);
  return plans;
}

export async function invalidatePlansCache(): Promise<void> {
  await redis.del(PLANS_CACHE_KEY);
}

export async function getPlanByCode(code: string): Promise<Plan | null> {
  const plans = await getActivePlans();
  return plans.find((p) => p.code === code) ?? null;
}

export interface SubStatus {
  active: boolean;
  plan: 'free' | 'basic' | 'pro';
  expiresAt: Date | null;
  isTrial: boolean;
  daysLeft: number;
}

export async function getSubscriptionStatus(userId: number): Promise<SubStatus> {
  const { data: user } = await supabase
    .from('users')
    .select('subscription_plan, subscription_expires_at, trial_used, trial_expires_at')
    .eq('id', userId)
    .single();

  if (!user) return { active: false, plan: 'free', expiresAt: null, isTrial: false, daysLeft: 0 };

  const now = new Date();
  const subExp = user.subscription_expires_at ? new Date(user.subscription_expires_at) : null;
  const trialExp = user.trial_expires_at ? new Date(user.trial_expires_at) : null;

  // Активная подписка
  if (subExp && subExp > now) {
    return {
      active: true,
      plan: user.subscription_plan as 'basic' | 'pro',
      expiresAt: subExp,
      isTrial: false,
      daysLeft: Math.ceil((subExp.getTime() - now.getTime()) / 86400000),
    };
  }

  // Активный trial
  if (trialExp && trialExp > now) {
    return {
      active: true,
      plan: 'pro',
      expiresAt: trialExp,
      isTrial: true,
      daysLeft: Math.ceil((trialExp.getTime() - now.getTime()) / 86400000),
    };
  }

  return { active: false, plan: 'free', expiresAt: null, isTrial: false, daysLeft: 0 };
}

// Активация trial — один раз на пользователя
export async function activateTrial(userId: number): Promise<{ success: boolean; days: number }> {
  const { data: user } = await supabase
    .from('users')
    .select('trial_used')
    .eq('id', userId)
    .single();

  if (!user || user.trial_used) return { success: false, days: 0 };

  const trialDays = await getConfig<number>('trial_days', 3);
  const expiresAt = new Date(Date.now() + trialDays * 86400000).toISOString();

  await supabase
    .from('users')
    .update({
      trial_used: true,
      trial_expires_at: expiresAt,
    })
    .eq('id', userId);

  return { success: true, days: trialDays };
}

// Продление подписки на N дней (используется при оплате и реферальных бонусах)
export async function extendSubscription(userId: number, days: number, plan: 'basic' | 'pro' = 'pro'): Promise<void> {
  const { data: user } = await supabase
    .from('users')
    .select('subscription_expires_at')
    .eq('id', userId)
    .single();

  const current = user?.subscription_expires_at ? new Date(user.subscription_expires_at) : new Date();
  const base = current > new Date() ? current : new Date();
  const newExpires = new Date(base.getTime() + days * 86400000).toISOString();

  await supabase
    .from('users')
    .update({
      subscription_plan: plan,
      subscription_expires_at: newExpires,
    })
    .eq('id', userId);

  // Инвалидируем кэш настроек доступа
  await redis.del(`user_access:${userId}`);
}
