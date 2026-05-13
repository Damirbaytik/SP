'use server';

import { requireAdmin } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';

export async function savePlan(plan: any) {
  await requireAdmin();
  const admin = createAdminClient();

  if (plan.id) {
    await admin.from('subscription_plans').update({
      code: plan.code,
      title: plan.title,
      days: plan.days,
      price_stars: plan.price_stars,
      price_rub: plan.price_rub,
      is_active: plan.is_active,
      sort_order: plan.sort_order,
    }).eq('id', plan.id);
    revalidatePath('/plans');
    return plan;
  }

  const { data } = await admin.from('subscription_plans').insert({
    code: plan.code,
    title: plan.title,
    days: plan.days,
    price_stars: plan.price_stars,
    price_rub: plan.price_rub,
    sort_order: plan.sort_order,
    is_active: true,
  }).select().single();

  revalidatePath('/plans');
  return data;
}

export async function deletePlan(id: number) {
  await requireAdmin();
  const admin = createAdminClient();
  await admin.from('subscription_plans').delete().eq('id', id);
  revalidatePath('/plans');
}
