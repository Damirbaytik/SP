import { Composer, InlineKeyboard } from 'grammy';
import type { BotContext } from '../../types.js';
import { messageCache, CachedMessage } from '../../services/cache.js';
import { supabase } from '../../services/supabase.js';
import { redis } from '../../services/redis.js';

export const spyModule = new Composer<BotContext>();

// Кэш владельца подключения (Redis, чтобы не дёргать Supabase каждый раз)
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

// Кэшируем каждое входящее business-сообщение
spyModule.on('business_message', async (ctx) => {
  const msg = ctx.businessMessage!;
  const connectionId = msg.business_connection_id;
  if (!connectionId) return;

  // Не кэшируем сообщения от владельца (только от собеседников)
  const ownerId = await getConnectionOwner(connectionId);
  if (!ownerId || msg.from?.id === ownerId) return;

  const cached: CachedMessage = {
    messageId: msg.message_id,
    chatId: msg.chat.id,
    senderId: msg.from?.id ?? 0,
    senderName: msg.from?.first_name ?? 'Unknown',
    senderUsername: msg.from?.username,
    text: msg.text,
    caption: msg.caption,
    mediaFileId: msg.photo?.at(-1)?.file_id
      ?? msg.video?.file_id
      ?? msg.document?.file_id
      ?? msg.voice?.file_id
      ?? msg.video_note?.file_id
      ?? msg.sticker?.file_id,
    mediaType: msg.photo ? 'photo'
      : msg.video ? 'video'
      : msg.document ? 'document'
      : msg.voice ? 'voice'
      : msg.video_note ? 'video_note'
      : msg.sticker ? 'sticker'
      : undefined,
    date: msg.date,
  };

  await messageCache.set(connectionId, cached);
});

// Ловим отредактированные сообщения
spyModule.on('edited_business_message', async (ctx) => {
  const msg = ctx.editedBusinessMessage!;
  const connectionId = msg.business_connection_id;
  if (!connectionId) return;

  const original = await messageCache.get(connectionId, msg.chat.id, msg.message_id);
  if (!original) return;

  // Получаем владельца бизнес-подключения
  const ownerId = await getConnectionOwner(connectionId);
  if (!ownerId) return;

  // Игнорируем редактирования от самого владельца
  if (msg.from?.id === ownerId) return;

  // Уведомляем пользователя
  const editedText = msg.text ?? msg.caption ?? '';
  const originalText = original.text ?? original.caption ?? '';

  // Проверяем изменилось ли медиа
  const newMediaFileId = msg.photo?.at(-1)?.file_id ?? msg.video?.file_id ?? msg.document?.file_id;
  const hasMediaChanged = !!(newMediaFileId && newMediaFileId !== original.mediaFileId);

  if (originalText !== editedText || hasMediaChanged) {
    const senderUsername = original.senderName;
    const botUsername = ctx.me.username;

    let captionText: string;
    if (hasMediaChanged && originalText === editedText) {
      // Заменили медиа (фото/видео)
      captionText =
        `<b>${senderUsername}</b> (@${msg.from?.username ?? 'unknown'}) заменил(а) медиа\n\n` +
        `@${botUsername}`;
    } else if (!originalText && editedText) {
      // Добавили подпись к медиа
      captionText =
        `<b>${senderUsername}</b> (@${msg.from?.username ?? 'unknown'}) добавил(а) подпись:\n\n` +
        `<blockquote>${editedText}</blockquote>\n\n` +
        `@${botUsername}`;
    } else if (originalText && !editedText) {
      // Удалили подпись
      captionText =
        `<b>${senderUsername}</b> (@${msg.from?.username ?? 'unknown'}) удалил(а) подпись:\n\n` +
        `<blockquote>${originalText}</blockquote>\n\n` +
        `@${botUsername}`;
    } else {
      captionText =
        `<b>${senderUsername}</b> (@${msg.from?.username ?? 'unknown'}) изменил(а) сообщение:\n\n` +
        `Old:\n<blockquote>${originalText}</blockquote>\n` +
        `New:\n<blockquote>${editedText}</blockquote>\n\n` +
        `@${botUsername}`;
    }

    if (original.mediaFileId && original.mediaType && ['photo', 'video', 'document', 'voice'].includes(original.mediaType)) {
      switch (original.mediaType) {
        case 'photo': await ctx.api.sendPhoto(ownerId, original.mediaFileId, { caption: captionText, parse_mode: 'HTML' }); break;
        case 'video': await ctx.api.sendVideo(ownerId, original.mediaFileId, { caption: captionText, parse_mode: 'HTML' }); break;
        case 'document': await ctx.api.sendDocument(ownerId, original.mediaFileId, { caption: captionText, parse_mode: 'HTML' }); break;
        case 'voice': await ctx.api.sendVoice(ownerId, original.mediaFileId, { caption: captionText, parse_mode: 'HTML' }); break;
      }
    } else if (original.mediaFileId && (original.mediaType === 'video_note' || original.mediaType === 'sticker')) {
      const sendFn = original.mediaType === 'video_note'
        ? () => ctx.api.sendVideoNote(ownerId, original.mediaFileId!)
        : () => ctx.api.sendSticker(ownerId, original.mediaFileId!);
      const sent = await sendFn();
      await ctx.api.sendMessage(ownerId, captionText, { parse_mode: 'HTML', reply_parameters: { message_id: sent.message_id } });
    } else {
      await ctx.api.sendMessage(ownerId, captionText, { parse_mode: 'HTML' });
    }

    // Сохраняем в лог
    await supabase.from('spy_logs').insert({
      user_id: ownerId,
      chat_id: msg.chat.id,
      message_id: msg.message_id,
      event_type: 'edited',
      original_text: originalText,
      edited_text: editedText,
      sender_id: original.senderId,
      sender_name: original.senderName,
    });
  }

  // Обновляем кэш новой версией
  const updated: CachedMessage = { ...original, text: msg.text, caption: msg.caption };
  await messageCache.set(connectionId, updated);
});

// Ловим удалённые сообщения
spyModule.on('deleted_business_messages', async (ctx) => {
  const deleted = ctx.deletedBusinessMessages!;
  const connectionId = deleted.business_connection_id;

  const ownerId = await getConnectionOwner(connectionId);
  if (!ownerId) return;

  // Собираем все найденные в кэше сообщения
  const found: CachedMessage[] = [];
  for (const messageId of deleted.message_ids) {
    const original = await messageCache.get(connectionId, deleted.chat.id, messageId);
    if (original) found.push(original);
  }

  if (found.length === 0) return;

  const botUsername = ctx.me.username;
  const senderName = found[0].senderName;

  // Если 1 сообщение — отправляем как раньше
  if (found.length === 1) {
    const original = found[0];
    const content = original.text ?? original.caption ?? '';

    const buildCaption = () => {
      const uname = original.senderUsername ? ` (@${original.senderUsername})` : '';
      let text = `<b>${senderName}</b>${uname} удалил(а) сообщение:`;
      if (content) text += `\n\n<blockquote>${content}</blockquote>`;
      text += `\n\n@${botUsername}`;
      return text;
    };

    if (original.mediaFileId && original.mediaType && ['photo', 'video', 'document', 'voice'].includes(original.mediaType)) {
      const cap = buildCaption();
      switch (original.mediaType) {
        case 'photo': await ctx.api.sendPhoto(ownerId, original.mediaFileId, { caption: cap, parse_mode: 'HTML' }); break;
        case 'video': await ctx.api.sendVideo(ownerId, original.mediaFileId, { caption: cap, parse_mode: 'HTML' }); break;
        case 'document': await ctx.api.sendDocument(ownerId, original.mediaFileId, { caption: cap, parse_mode: 'HTML' }); break;
        case 'voice': await ctx.api.sendVoice(ownerId, original.mediaFileId, { caption: cap, parse_mode: 'HTML' }); break;
      }
    } else if (original.mediaFileId && original.mediaType === 'video_note') {
      const sent = await ctx.api.sendVideoNote(ownerId, original.mediaFileId);
      await ctx.api.sendMessage(ownerId, buildCaption(), { parse_mode: 'HTML', reply_parameters: { message_id: sent.message_id } });
    } else if (original.mediaFileId && original.mediaType === 'sticker') {
      const sent = await ctx.api.sendSticker(ownerId, original.mediaFileId);
      await ctx.api.sendMessage(ownerId, buildCaption(), { parse_mode: 'HTML', reply_parameters: { message_id: sent.message_id } });
    } else {
      await ctx.api.sendMessage(ownerId, buildCaption(), { parse_mode: 'HTML' });
    }
  } else {
    // Несколько сообщений — сохраняем batch и отправляем одно уведомление с кнопкой
    const batchId = `${Date.now()}`;
    await messageCache.setDeletedBatch(ownerId, batchId, found);

    const keyboard = new InlineKeyboard()
      .text(`👁 Показать (${found.length})`, `show_deleted:${batchId}`);

    await ctx.api.sendMessage(
      ownerId,
      `<b>${senderName}</b> (@${found[0].senderUsername ?? 'unknown'}) удалил(а) <b>${found.length}</b> сообщений\n\n@${botUsername}`,
      { parse_mode: 'HTML', reply_markup: keyboard }
    );
  }

  // Логируем и чистим кэш
  for (const original of found) {
    await supabase.from('spy_logs').insert({
      user_id: ownerId,
      chat_id: deleted.chat.id,
      message_id: original.messageId,
      event_type: 'deleted',
      original_text: original.text ?? original.caption,
      media_file_id: original.mediaFileId,
      sender_id: original.senderId,
      sender_name: original.senderName,
    });
    await messageCache.del(connectionId, deleted.chat.id, original.messageId);
  }
});

// Обработка кнопки "Показать" для batch удалений
spyModule.callbackQuery(/^show_deleted:(\d+)$/, async (ctx) => {
  const batchId = ctx.match![1];
  const userId = ctx.from!.id;

  const batch = await messageCache.getDeletedBatch(userId, batchId);
  if (!batch || batch.length === 0) {
    await ctx.answerCallbackQuery('Данные истекли');
    return;
  }

  await ctx.answerCallbackQuery();

  const botUsername = ctx.me.username;

  // Отправляем все сообщения
  for (const msg of batch) {
    const content = msg.text ?? msg.caption ?? '';
    const buildCaption = () => {
      let text = `<b>${msg.senderName}</b> (@${msg.senderUsername ?? 'unknown'}) удалил(а):`;
      if (content) text += `\n\n<blockquote>${content}</blockquote>`;
      text += `\n\n@${botUsername}`;
      return text;
    };

    try {
      if (msg.mediaFileId && msg.mediaType && ['photo', 'video', 'document', 'voice'].includes(msg.mediaType)) {
        const cap = buildCaption();
        switch (msg.mediaType) {
          case 'photo': await ctx.api.sendPhoto(userId, msg.mediaFileId, { caption: cap, parse_mode: 'HTML' }); break;
          case 'video': await ctx.api.sendVideo(userId, msg.mediaFileId, { caption: cap, parse_mode: 'HTML' }); break;
          case 'document': await ctx.api.sendDocument(userId, msg.mediaFileId, { caption: cap, parse_mode: 'HTML' }); break;
          case 'voice': await ctx.api.sendVoice(userId, msg.mediaFileId, { caption: cap, parse_mode: 'HTML' }); break;
        }
      } else if (msg.mediaFileId && msg.mediaType === 'video_note') {
        const sent = await ctx.api.sendVideoNote(userId, msg.mediaFileId);
        await ctx.api.sendMessage(userId, buildCaption(), { parse_mode: 'HTML', reply_parameters: { message_id: sent.message_id } });
      } else if (msg.mediaFileId && msg.mediaType === 'sticker') {
        const sent = await ctx.api.sendSticker(userId, msg.mediaFileId);
        await ctx.api.sendMessage(userId, buildCaption(), { parse_mode: 'HTML', reply_parameters: { message_id: sent.message_id } });
      } else {
        await ctx.api.sendMessage(userId, buildCaption(), { parse_mode: 'HTML' });
      }
    } catch (err: any) {
      if (err.error_code === 429) {
        const wait = err.parameters?.retry_after ?? 3;
        await new Promise(r => setTimeout(r, wait * 1000));
      }
    }
  }
});
