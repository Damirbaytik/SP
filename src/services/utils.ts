import { supabase } from './supabase.js';

// Экранирование HTML для безопасной вставки в parse_mode: HTML
export function escapeHtml(text: string | undefined | null): string {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Батчинг insert в spy_logs — копим в памяти, сбрасываем пачкой раз в 5 сек
interface SpyLogEntry {
  user_id: number;
  chat_id: number;
  message_id: number;
  event_type: 'deleted' | 'edited';
  original_text?: string | null;
  edited_text?: string | null;
  media_file_id?: string | null;
  sender_id: number;
  sender_name: string;
}

const logQueue: SpyLogEntry[] = [];
const FLUSH_INTERVAL_MS = 5000;
const MAX_BATCH_SIZE = 500;

export function queueSpyLog(entry: SpyLogEntry): void {
  logQueue.push(entry);
  if (logQueue.length >= MAX_BATCH_SIZE) {
    flushSpyLogs().catch((err) => console.error('[SpyLogs] Flush error:', err.message));
  }
}

async function flushSpyLogs(): Promise<void> {
  if (logQueue.length === 0) return;
  const batch = logQueue.splice(0, logQueue.length);
  const { error } = await supabase.from('spy_logs').insert(batch);
  if (error) {
    console.error('[SpyLogs] Insert error:', error.message);
    // Возвращаем в очередь только если не дубликат
    if (!error.message.includes('duplicate')) {
      logQueue.unshift(...batch);
    }
  }
}

// Периодический flush
setInterval(() => {
  flushSpyLogs().catch(() => {});
}, FLUSH_INTERVAL_MS);

// Flush при завершении процесса
process.on('SIGTERM', () => flushSpyLogs());
process.on('SIGINT', () => flushSpyLogs());
