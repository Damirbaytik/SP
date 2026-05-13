import { requireAdmin } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/server';
import { PlansTable } from './plans-table';
import Link from 'next/link';

export default async function PlansPage() {
  await requireAdmin();
  const admin = createAdminClient();
  const { data: plans } = await admin.from('subscription_plans').select('*').order('sort_order');

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white shadow px-6 py-4">
        <Link href="/" className="text-blue-600">← Dashboard</Link>
      </nav>
      <main className="max-w-6xl mx-auto p-6">
        <h2 className="text-2xl font-bold mb-6">Тарифы</h2>
        <PlansTable plans={plans ?? []} />
      </main>
    </div>
  );
}
