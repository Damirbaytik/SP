'use server';

import { requireAdmin } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';

export async function updateUser(userId: number, data: { subscription_plan: string; subscription_expires_at: string | null }) {
  await requireAdmin();
  const admin = createAdminClient();

  await admin.from('users').update({
    subscription_plan: data.subscription_plan,
    subscription_expires_at: data.subscription_expires_at,
  }).eq('id', userId);

  revalidatePath('/users');
}
