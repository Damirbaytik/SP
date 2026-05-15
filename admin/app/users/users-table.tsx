'use client';

import { useState } from 'react';
import { updateUser } from './actions';

interface User {
  id: number;
  username: string | null;
  first_name: string | null;
  subscription_plan: string;
  subscription_expires_at: string | null;
  trial_used: boolean;
  business_connection_id: string | null;
  business_connections: { id: string; is_enabled: boolean }[];
  referral_code: string | null;
  referred_by: number | null;
  created_at: string;
}

export function UsersTable({ users }: { users: User[] }) {
  const [search, setSearch] = useState('');

  const filtered = users.filter(u =>
    (u.username ?? '').toLowerCase().includes(search.toLowerCase()) ||
    (u.first_name ?? '').toLowerCase().includes(search.toLowerCase()) ||
    String(u.id).includes(search)
  );

  return (
    <div>
      <input
        type="text"
        placeholder="Поиск по имени, username или ID..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full mb-4 px-4 py-2 border rounded focus:ring-2 focus:ring-blue-500 outline-none"
      />

      <div className="bg-white rounded-lg shadow overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left">
            <tr>
              <th className="p-3">ID</th>
              <th className="p-3">Имя</th>
              <th className="p-3">Username</th>
              <th className="p-3">Бизнес</th>
              <th className="p-3">План</th>
              <th className="p-3">Истекает</th>
              <th className="p-3">Trial</th>
              <th className="p-3">Реферер</th>
              <th className="p-3">Дата</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((user) => (
              <UserRow key={user.id} user={user} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function UserRow({ user }: { user: any }) {
  const [plan, setPlan] = useState(user.subscription_plan ?? 'free');
  const [expires, setExpires] = useState(user.subscription_expires_at?.slice(0, 10) ?? '');
  const [saving, setSaving] = useState(false);

  const hasConnection = user.business_connections?.some((c: any) => c.is_enabled);

  async function save() {
    setSaving(true);
    await updateUser(user.id, {
      subscription_plan: plan,
      subscription_expires_at: expires ? new Date(expires).toISOString() : null,
    });
    setSaving(false);
  }

  return (
    <tr className="border-t hover:bg-gray-50">
      <td className="p-3 font-mono text-xs">{user.id}</td>
      <td className="p-3">{user.first_name ?? '—'}</td>
      <td className="p-3 text-blue-600">@{user.username ?? '—'}</td>
      <td className="p-3">
        {hasConnection ? (
          <span className="px-2 py-0.5 bg-green-100 text-green-800 rounded text-xs">Подключен</span>
        ) : (
          <span className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded text-xs">Нет</span>
        )}
      </td>
      <td className="p-3">
        <select value={plan} onChange={(e) => setPlan(e.target.value)} className="border rounded px-2 py-1 text-xs">
          <option value="free">free</option>
          <option value="basic">basic</option>
          <option value="pro">pro</option>
        </select>
      </td>
      <td className="p-3">
        <input
          type="date"
          value={expires}
          onChange={(e) => setExpires(e.target.value)}
          className="border rounded px-2 py-1 text-xs"
        />
      </td>
      <td className="p-3">{user.trial_used ? '✅' : '—'}</td>
      <td className="p-3 font-mono text-xs">{user.referred_by ?? '—'}</td>
      <td className="p-3 text-xs text-gray-500">{new Date(user.created_at).toLocaleDateString('ru')}</td>
      <td className="p-3">
        <button
          onClick={save}
          disabled={saving}
          className="px-3 py-1 bg-blue-600 text-white rounded text-xs disabled:opacity-50"
        >
          {saving ? '...' : 'Сохранить'}
        </button>
      </td>
    </tr>
  );
}
