'use client';

import { useState } from 'react';
import { saveConfig } from './actions';

interface ConfigItem {
  key: string;
  value: any;
  description: string | null;
}

export function ConfigForm({ config }: { config: ConfigItem[] }) {
  const [items, setItems] = useState<ConfigItem[]>(
    config.map((c) => ({ ...c, value: JSON.stringify(c.value) }))
  );
  const [saving, setSaving] = useState<string | null>(null);

  async function save(key: string, value: string) {
    setSaving(key);
    try {
      const parsed = JSON.parse(value);
      await saveConfig(key, parsed);
    } catch (e) {
      alert('Неверный JSON: ' + (e as Error).message);
    }
    setSaving(null);
  }

  return (
    <div className="bg-white rounded-lg shadow divide-y">
      {items.map((item) => (
        <div key={item.key} className="p-4">
          <div className="flex justify-between items-center mb-2">
            <div>
              <code className="font-mono font-bold">{item.key}</code>
              {item.description && <p className="text-sm text-gray-500">{item.description}</p>}
            </div>
            <button
              onClick={() => save(item.key, item.value)}
              disabled={saving === item.key}
              className="px-4 py-1 bg-blue-600 text-white rounded text-sm disabled:opacity-50"
            >
              {saving === item.key ? '...' : 'Сохранить'}
            </button>
          </div>
          <textarea
            value={item.value}
            onChange={(e) => setItems((prev) => prev.map((i) => i.key === item.key ? { ...i, value: e.target.value } : i))}
            className="w-full font-mono text-sm border rounded p-2"
            rows={2}
          />
        </div>
      ))}
    </div>
  );
}
