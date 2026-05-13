import { requireAdmin } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/server';
import { ConfigForm } from './config-form';
import Link from 'next/link';

export default async function ConfigPage() {
  await requireAdmin();
  const admin = createAdminClient();
  const { data: config } = await admin.from('bot_config').select('*').order('key');

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white shadow px-6 py-4">
        <Link href="/" className="text-blue-600">← Dashboard</Link>
      </nav>
      <main className="max-w-4xl mx-auto p-6">
        <h2 className="text-2xl font-bold mb-6">Настройки бота</h2>
        <ConfigForm config={config ?? []} />
      </main>
    </div>
  );
}
