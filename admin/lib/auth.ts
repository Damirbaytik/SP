import { createClient, createAdminClient } from './supabase/server';
import { redirect } from 'next/navigation';

// Проверяет что текущий юзер — админ (через email в bot_config.admin_emails или telegram_id)
export async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  const admin = createAdminClient();
  const { data: config } = await admin
    .from('bot_config')
    .select('value')
    .eq('key', 'admin_emails')
    .single();

  const allowedEmails = (config?.value as string[]) ?? [];
  if (!allowedEmails.includes(user.email ?? '')) {
    redirect('/login?error=not_admin');
  }

  return user;
}
