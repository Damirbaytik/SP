'use server';

import { requireAdmin } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';

export async function saveConfig(key: string, value: any) {
  await requireAdmin();
  const admin = createAdminClient();
  await admin.from('bot_config').update({ value, updated_at: new Date().toISOString() }).eq('key', key);
  revalidatePath('/config');
}
