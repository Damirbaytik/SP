import { requireAdmin } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/server';
import Link from 'next/link';
import { Users, CreditCard, Settings, Sparkles, DollarSign } from 'lucide-react';

export default async function Dashboard() {
  await requireAdmin();
  const admin = createAdminClient();

  const [{ count: usersCount }, { count: activeSubsCount }, { count: paymentsCount }, { count: animationsCount }] = await Promise.all([
    admin.from('users').select('*', { count: 'exact', head: true }),
    admin.from('users').select('*', { count: 'exact', head: true }).gt('subscription_expires_at', new Date().toISOString()),
    admin.from('payments').select('*', { count: 'exact', head: true }).eq('status', 'completed'),
    admin.from('animations').select('*', { count: 'exact', head: true }),
  ]);

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white shadow px-6 py-4">
        <h1 className="text-xl font-bold">SpyDialogBot Admin</h1>
      </nav>
      <main className="max-w-6xl mx-auto p-6">
        <h2 className="text-2xl font-bold mb-6">Dashboard</h2>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <StatCard label="Пользователей" value={usersCount ?? 0} icon={<Users />} />
          <StatCard label="Активных подписок" value={activeSubsCount ?? 0} icon={<CreditCard />} />
          <StatCard label="Оплат" value={paymentsCount ?? 0} icon={<DollarSign />} />
          <StatCard label="Анимаций" value={animationsCount ?? 0} icon={<Sparkles />} />
        </div>

        <h3 className="text-lg font-semibold mb-3">Разделы</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <NavCard href="/users" title="Пользователи" description="Управление пользователями и подписками" icon={<Users />} />
          <NavCard href="/plans" title="Тарифы" description="Настройка тарифных планов" icon={<CreditCard />} />
          <NavCard href="/animations" title="Анимации" description="Управление анимациями" icon={<Sparkles />} />
          <NavCard href="/payments" title="Платежи" description="История платежей" icon={<DollarSign />} />
          <NavCard href="/config" title="Настройки бота" description="Триал, рефералка, админы" icon={<Settings />} />
        </div>
      </main>
    </div>
  );
}

function StatCard({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }) {
  return (
    <div className="bg-white p-5 rounded-lg shadow flex items-center gap-4">
      <div className="p-2 bg-blue-50 text-blue-600 rounded">{icon}</div>
      <div>
        <div className="text-sm text-gray-500">{label}</div>
        <div className="text-2xl font-bold">{value}</div>
      </div>
    </div>
  );
}

function NavCard({ href, title, description, icon }: { href: string; title: string; description: string; icon: React.ReactNode }) {
  return (
    <Link href={href} className="bg-white p-5 rounded-lg shadow hover:shadow-md transition">
      <div className="flex items-center gap-3 mb-2">
        <div className="text-blue-600">{icon}</div>
        <h4 className="font-semibold">{title}</h4>
      </div>
      <p className="text-sm text-gray-600">{description}</p>
    </Link>
  );
}
