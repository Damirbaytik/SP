import { createClient, createAdminClient } from './supabase/server';
import { redirect } from 'next/navigation';

export async function requireAdmin() {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();

  if (!session) redirect('/login');

  const user = session.user;
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
