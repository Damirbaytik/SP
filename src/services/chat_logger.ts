import { supabase } from './supabase.js';

interface ChatMessageEntry {
  owner_id: number;
  connection_id: string;
  chat_id: number;
  chat_name?: string;
  chat_username?: string;
  message_id: number;
  sender_id: number;
  sender_name?: string;
  sender_username?: string;
  from_me: boolean;
  text?: string;
  kind: string;
  status: 'normal' | 'edited' | 'deleted';
  media_file_id?: string;
  reply_to_message_id?: number;
}

const queue: ChatMessageEntry[] = [];
const contactUpdates = new Map<string, {
  owner_id: number;
  connection_id: string;
  chat_id: number;
  chat_name?: string;
  chat_username?: string;
  last_message_text: string;
  last_message_at: string;
}>();

const FLUSH_MS = 1000;
const MAX_BATCH = 500;

export function logMessage(entry: ChatMessageEntry): void {
  queue.push(entry);

  // Обновление контакта (для списка чатов)
  const key = `${entry.connection_id}:${entry.chat_id}`;
  contactUpdates.set(key, {
    owner_id: entry.owner_id,
    connection_id: entry.connection_id,
    chat_id: entry.chat_id,
    chat_name: entry.chat_name,
    chat_username: entry.chat_username,
    last_message_text: entry.text || `[${entry.kind}]`,
    last_message_at: new Date().toISOString(),
  });

  if (queue.length >= MAX_BATCH) {
    flush().catch((err) => console.error('[ChatLogger] Flush error:', err.message));
  }
}

// Обновление существующего сообщения (редактирование/удаление)
export async function updateMessageStatus(
  connection_id: string,
  chat_id: number,
  message_id: number,
  status: 'edited' | 'deleted',
  newText?: string,
  originalText?: string
): Promise<void> {
  const update: any = { status };
  if (status === 'edited') {
    update.edited_at = new Date().toISOString();
    if (newText !== undefined) update.text = newText;
    if (originalText !== undefined) update.original_text = originalText;
  } else if (status === 'deleted') {
    update.deleted_at = new Date().toISOString();
  }

  await supabase
    .from('chat_messages')
    .update(update)
    .eq('connection_id', connection_id)
    .eq('chat_id', chat_id)
    .eq('message_id', message_id);
}

async function flush(): Promise<void> {
  if (queue.length === 0 && contactUpdates.size === 0) return;

  const batch = queue.splice(0, queue.length);
  const contacts = Array.from(contactUpdates.values());
  contactUpdates.clear();

  // Batch insert сообщений (игнорируем дубликаты по unique constraint)
  if (batch.length > 0) {
    const { error } = await supabase
      .from('chat_messages')
      .insert(batch);
    if (error && !error.message.includes('duplicate')) {
      console.error('[ChatLogger] Insert error:', error.message);
    }
  }

  // Обновление контактов
  if (contacts.length > 0) {
    const { error } = await supabase
      .from('chat_contacts')
      .upsert(contacts, { onConflict: 'connection_id,chat_id' });
    if (error) console.error('[ChatLogger] Contacts error:', error.message);
  }
}

setInterval(() => {
  flush().catch(() => {});
}, FLUSH_MS);

process.on('SIGTERM', () => flush());
process.on('SIGINT', () => flush());
