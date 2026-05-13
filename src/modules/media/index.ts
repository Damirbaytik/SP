import { Composer, InputFile } from 'grammy';
import type { BotContext } from '../../types.js';
import { supabase } from '../../services/supabase.js';
import { redis } from '../../services/redis.js';
import { getConnectionOwner } from '../../services/connection.js';
import { getUserSettings } from '../../services/settings.js';
import { escapeHtml } from '../../services/utils.js';

export const mediaModule = new Composer<BotContext>();

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB

// Владелец отвечает на фото/видео — если self-destruct, сохраняем
mediaModule.on('business_message', async (ctx, next) => {
  const msg = ctx.businessMessage!;
  const connectionId = msg.business_connection_id;
  if (!connectionId) return next();

  const replyTo = msg.reply_to_message;
  if (!replyTo) return next();

  const ownerId = await getConnectionOwner(connectionId);
  if (!ownerId || msg.from?.id !== ownerId) return next();

  const settings = await getUserSettings(ownerId);
  if (!settings.notify_timer_media) return next();

  const fileId = replyTo.photo?.at(-1)?.file_id ?? replyTo.video?.file_id;
  if (!fileId) return next();

  const fileType = replyTo.photo ? 'photo' : 'video';

  // Дедупликация
  const dedupeKey = `saved:${connectionId}:${replyTo.message_id}`;
  if (await redis.get(dedupeKey)) return next();

  try {
    const file = await ctx.api.getFile(fileId);
    if (file.file_size && file.file_size > MAX_FILE_SIZE) return next();

    const fileUrl = `https://api.telegram.org/file/bot${ctx.api.token}/${file.file_path}`;
    const response = await fetch(fileUrl);

    // Проверка размера по заголовку
    const contentLength = response.headers.get('content-length');
    if (contentLength && parseInt(contentLength) > MAX_FILE_SIZE) return next();

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > MAX_FILE_SIZE) return next();

    const inputFile = new InputFile(buffer, file.file_path?.split('/').pop() ?? 'media');

    const name = escapeHtml(replyTo.from?.first_name ?? 'Собеседник');
    const uname = escapeHtml(replyTo.from?.username ?? 'unknown');
    const caption = `<b>${name}</b> (@${uname}) отправил(а) медиа с таймером\n✅ Сохранено!`;

    if (fileType === 'photo') {
      await ctx.api.sendPhoto(ownerId, inputFile, { caption, parse_mode: 'HTML' });
    } else {
      await ctx.api.sendVideo(ownerId, inputFile, { caption, parse_mode: 'HTML' });
    }

    await redis.set(dedupeKey, '1', 'EX', 86400);

    // Не блокируем на insert
    supabase.from('saved_media').insert({
      user_id: ownerId,
      chat_id: msg.chat.id,
      message_id: replyTo.message_id,
      file_id: fileId,
      file_type: fileType,
    }).then(() => {}, (err) => console.error('[Media] DB insert error:', err.message));
  } catch {
    // Не таймерное / нет прав / ошибка сети — пропускаем молча
  }

  return next();
});
