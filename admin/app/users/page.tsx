import { requireAdmin } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/server';
import { UsersTable } from './users-table';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function UsersPage() {
  await requireAdmin();
  const admin = createAdminClient();

  const { data: users } = await admin
    .from('users')
    .select('*, business_connections(id, is_enabled)')
    .order('created_at', { ascending: false });

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white shadow px-6 py-4">
        <Link href="/" className="text-blue-600">&larr; Dashboard</Link>
      </nav>
      <main className="max-w-7xl mx-auto p-6">
        <h2 className="text-2xl font-bold mb-6">Пользователи ({users?.length ?? 0})</h2>
        <UsersTable users={users ?? []} />
      </main>
    </div>
  );
}
