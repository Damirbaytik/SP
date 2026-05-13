import { Composer, InputFile } from 'grammy';
import type { BotContext } from '../../types.js';
import { supabase } from '../../services/supabase.js';
import { redis } from '../../services/redis.js';

export const mediaModule = new Composer<BotContext>();

// Кэш владельца
async function getConnectionOwner(connectionId: string): Promise<number | null> {
  const cacheKey = `bc_owner:${connectionId}`;
  const cached = await redis.get(cacheKey);
  if (cached) return parseInt(cached);

  const { data } = await supabase
    .from('business_connections')
    .select('user_id')
    .eq('id', connectionId)
    .single();

  if (!data) return null;
  await redis.set(cacheKey, String(data.user_id), 'EX', 86400);
  return data.user_id;
}

// Владелец отвечает на фото/видео — если self-destruct, сохраняем
mediaModule.on('business_message', async (ctx, next) => {
  const msg = ctx.businessMessage!;
  const connectionId = msg.business_connection_id;
  if (!connectionId) return next();

  const replyTo = msg.reply_to_message;
  if (!replyTo) return next();

  // Проверяем что это владелец
  const ownerId = await getConnectionOwner(connectionId);
  if (!ownerId || msg.from?.id !== ownerId) return next();

  // Ищем медиа в reply
  const fileId = replyTo.photo?.at(-1)?.file_id ?? replyTo.video?.file_id;
  if (!fileId) return next();

  const fileType = replyTo.photo ? 'photo' : 'video';

  // Дедупликация
  const dedupeKey = `saved:${connectionId}:${replyTo.message_id}`;
  if (await redis.get(dedupeKey)) return next();

  // Скачиваем и отправляем (getFile работает для self-destruct до открытия)
  try {
    const file = await ctx.api.getFile(fileId);
    const fileUrl = `https://api.telegram.org/file/bot${ctx.api.token}/${file.file_path}`;
    const response = await fetch(fileUrl);
    const buffer = Buffer.from(await response.arrayBuffer());
    const inputFile = new InputFile(buffer, file.file_path?.split('/').pop() ?? 'media');

    const caption = `<b>${replyTo.from?.first_name ?? 'Собеседник'}</b> (@${replyTo.from?.username ?? 'unknown'}) отправил(а) медиа с таймером\n✅ Сохранено!`;

    if (fileType === 'photo') {
      await ctx.api.sendPhoto(ownerId, inputFile, { caption, parse_mode: 'HTML' });
    } else {
      await ctx.api.sendVideo(ownerId, inputFile, { caption, parse_mode: 'HTML' });
    }

    await redis.set(dedupeKey, '1', 'EX', 86400);

    await supabase.from('saved_media').insert({
      user_id: ownerId,
      chat_id: msg.chat.id,
      message_id: replyTo.message_id,
      file_id: fileId,
      file_type: fileType,
    });
  } catch (err: any) {
    // Если ошибка НЕ связана с self-destruct — пропускаем молча
    if (!err.message?.includes('SelfDestruct') && !err.message?.includes('wrong file')) {
      // Обычное фото — не сохраняем, просто пропускаем
    }
  }

  return next();
});
