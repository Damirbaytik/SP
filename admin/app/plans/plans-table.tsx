'use client';

import { useState } from 'react';
import { savePlan, deletePlan } from './actions';

interface Plan {
  id: number;
  code: string;
  title: string;
  days: number;
  price_stars: number;
  price_rub: number;
  is_active: boolean;
  sort_order: number;
}

export function PlansTable({ plans: initialPlans }: { plans: Plan[] }) {
  const [plans, setPlans] = useState<Plan[]>(initialPlans);
  const [adding, setAdding] = useState(false);

  function updateField(id: number, field: keyof Plan, value: any) {
    setPlans((prev) => prev.map((p) => (p.id === id ? { ...p, [field]: value } : p)));
  }

  async function save(plan: Plan) {
    await savePlan(plan);
  }

  async function remove(id: number) {
    if (!confirm('Удалить тариф?')) return;
    await deletePlan(id);
    setPlans((prev) => prev.filter((p) => p.id !== id));
  }

  return (
    <div className="bg-white rounded-lg shadow overflow-hidden">
      <table className="w-full">
        <thead className="bg-gray-50 text-left text-sm">
          <tr>
            <th className="p-3">Code</th>
            <th className="p-3">Название</th>
            <th className="p-3">Дней</th>
            <th className="p-3">Stars</th>
            <th className="p-3">Рубли</th>
            <th className="p-3">Активен</th>
            <th className="p-3">Порядок</th>
            <th className="p-3"></th>
          </tr>
        </thead>
        <tbody>
          {plans.map((plan) => (
            <tr key={plan.id} className="border-t">
              <td className="p-3"><input value={plan.code} onChange={(e) => updateField(plan.id, 'code', e.target.value)} className="border px-2 py-1 rounded w-24" /></td>
              <td className="p-3"><input value={plan.title} onChange={(e) => updateField(plan.id, 'title', e.target.value)} className="border px-2 py-1 rounded w-32" /></td>
              <td className="p-3"><input type="number" value={plan.days} onChange={(e) => updateField(plan.id, 'days', +e.target.value)} className="border px-2 py-1 rounded w-20" /></td>
              <td className="p-3"><input type="number" value={plan.price_stars} onChange={(e) => updateField(plan.id, 'price_stars', +e.target.value)} className="border px-2 py-1 rounded w-20" /></td>
              <td className="p-3"><input type="number" value={plan.price_rub} onChange={(e) => updateField(plan.id, 'price_rub', +e.target.value)} className="border px-2 py-1 rounded w-20" /></td>
              <td className="p-3"><input type="checkbox" checked={plan.is_active} onChange={(e) => updateField(plan.id, 'is_active', e.target.checked)} /></td>
              <td className="p-3"><input type="number" value={plan.sort_order} onChange={(e) => updateField(plan.id, 'sort_order', +e.target.value)} className="border px-2 py-1 rounded w-16" /></td>
              <td className="p-3 flex gap-2">
                <button onClick={() => save(plan)} className="px-3 py-1 bg-blue-600 text-white rounded text-sm">Сохранить</button>
                <button onClick={() => remove(plan.id)} className="px-3 py-1 bg-red-600 text-white rounded text-sm">×</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="p-3">
        <button onClick={() => setAdding(true)} className="px-4 py-2 bg-green-600 text-white rounded">+ Новый тариф</button>
      </div>

      {adding && <NewPlanForm onSave={(p) => { setPlans([...plans, p]); setAdding(false); }} onCancel={() => setAdding(false)} />}
    </div>
  );
}

function NewPlanForm({ onSave, onCancel }: { onSave: (p: Plan) => void; onCancel: () => void }) {
  const [form, setForm] = useState({ code: '', title: '', days: 30, price_stars: 100, price_rub: 299, sort_order: 0 });

  async function submit() {
    const result = await savePlan({ ...form, id: 0, is_active: true } as Plan);
    if (result) onSave(result);
  }

  return (
    <div className="p-4 bg-gray-50 border-t">
      <div className="grid grid-cols-6 gap-2 mb-3">
        <input placeholder="code" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} className="border px-2 py-1 rounded" />
        <input placeholder="Название" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="border px-2 py-1 rounded" />
        <input type="number" placeholder="Дней" value={form.days} onChange={(e) => setForm({ ...form, days: +e.target.value })} className="border px-2 py-1 rounded" />
        <input type="number" placeholder="Stars" value={form.price_stars} onChange={(e) => setForm({ ...form, price_stars: +e.target.value })} className="border px-2 py-1 rounded" />
        <input type="number" placeholder="Рубли" value={form.price_rub} onChange={(e) => setForm({ ...form, price_rub: +e.target.value })} className="border px-2 py-1 rounded" />
        <input type="number" placeholder="Порядок" value={form.sort_order} onChange={(e) => setForm({ ...form, sort_order: +e.target.value })} className="border px-2 py-1 rounded" />
      </div>
      <div className="flex gap-2">
        <button onClick={submit} className="px-4 py-2 bg-blue-600 text-white rounded">Создать</button>
        <button onClick={onCancel} className="px-4 py-2 border rounded">Отмена</button>
      </div>
    </div>
  );
}
