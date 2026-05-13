import { Composer } from 'grammy';
import type { BotContext } from '../../types.js';
import { supabase } from '../../services/supabase.js';

export const businessModule = new Composer<BotContext>();

// Обработка подключения/отключения Business Connection
businessModule.on('business_connection', async (ctx) => {
  const conn = ctx.businessConnection!;

  // Upsert пользователя
  await supabase.from('users').upsert({
    id: conn.user.id,
    username: conn.user.username,
    first_name: conn.user.first_name,
    is_premium: conn.user.is_premium ?? false,
  }, { onConflict: 'id' });

  if (!conn.is_enabled) {
    // Отключение
    await supabase
      .from('business_connections')
      .update({ is_enabled: false, disconnected_at: new Date().toISOString() })
      .eq('id', conn.id);

    await ctx.api.sendMessage(conn.user.id, '❌ Бизнес-подключение отключено. Spy-функции неактивны.');
    return;
  }

  // Подключение
  await supabase.from('business_connections').upsert({
    id: conn.id,
    user_id: conn.user.id,
    can_reply: conn.can_reply,
    is_enabled: true,
    connected_at: new Date().toISOString(),
    disconnected_at: null,
  }, { onConflict: 'id' });

  // Обновляем business_connection_id у пользователя
  await supabase
    .from('users')
    .update({ business_connection_id: conn.id })
    .eq('id', conn.user.id);

  // Создаём настройки по умолчанию
  await supabase.from('user_settings').upsert({
    user_id: conn.user.id,
  }, { onConflict: 'user_id' });

  await ctx.api.sendMessage(
    conn.user.id,
    '✅ Бизнес-подключение активировано!\n\n' +
    '🕵️ Spy-модуль включён — я буду ловить удалённые и изменённые сообщения.\n\n' +
    'Используй /settings для настройки.'
  );
});
