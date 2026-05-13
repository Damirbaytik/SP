import { Composer, InlineKeyboard } from 'grammy';
import type { BotContext } from '../../types.js';
import { messageCache, CachedMessage } from '../../services/cache.js';
import { getConnectionOwner } from '../../services/connection.js';
import { getUserSettings } from '../../services/settings.js';
import { escapeHtml, queueSpyLog } from '../../services/utils.js';

export const spyModule = new Composer<BotContext>();

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

  const ownerId = await getConnectionOwner(connectionId);
  if (!ownerId || msg.from?.id === ownerId) return;

  const settings = await getUserSettings(ownerId);
  if (!settings.spy_enabled || !settings.notify_edited) return;

  const editedText = msg.text ?? msg.caption ?? '';
  const originalText = original.text ?? original.caption ?? '';

  const newMediaFileId = msg.photo?.at(-1)?.file_id ?? msg.video?.file_id ?? msg.document?.file_id;
  const hasMediaChanged = !!(newMediaFileId && newMediaFileId !== original.mediaFileId);

  if (originalText !== editedText || hasMediaChanged) {
    const name = escapeHtml(original.senderName);
    const uname = escapeHtml(msg.from?.username ?? 'unknown');
    const oldEsc = escapeHtml(originalText);
    const newEsc = escapeHtml(editedText);
    const botUsername = ctx.me.username;

    let captionText: string;
    if (hasMediaChanged && originalText === editedText) {
      captionText =
        `<b>${name}</b> (@${uname}) заменил(а) медиа\n\n@${botUsername}`;
    } else if (!originalText && editedText) {
      captionText =
        `<b>${name}</b> (@${uname}) добавил(а) подпись:\n\n` +
        `<blockquote>${newEsc}</blockquote>\n\n@${botUsername}`;
    } else if (originalText && !editedText) {
      captionText =
        `<b>${name}</b> (@${uname}) удалил(а) подпись:\n\n` +
        `<blockquote>${oldEsc}</blockquote>\n\n@${botUsername}`;
    } else {
      captionText =
        `<b>${name}</b> (@${uname}) изменил(а) сообщение:\n\n` +
        `Old:\n<blockquote>${oldEsc}</blockquote>\n` +
        `New:\n<blockquote>${newEsc}</blockquote>\n\n@${botUsername}`;
    }

    if (original.mediaFileId && original.mediaType && ['photo', 'video', 'document', 'voice'].includes(original.mediaType)) {
      const opts = { caption: captionText, parse_mode: 'HTML' as const };
      switch (original.mediaType) {
        case 'photo': await ctx.api.sendPhoto(ownerId, original.mediaFileId, opts); break;
        case 'video': await ctx.api.sendVideo(ownerId, original.mediaFileId, opts); break;
        case 'document': await ctx.api.sendDocument(ownerId, original.mediaFileId, opts); break;
        case 'voice': await ctx.api.sendVoice(ownerId, original.mediaFileId, opts); break;
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

    // В очередь (не блокирует hot path)
    queueSpyLog({
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

  const settings = await getUserSettings(ownerId);
  if (!settings.spy_enabled || !settings.notify_deleted) return;

  // Собираем все найденные в кэше сообщения параллельно
  const found: CachedMessage[] = (
    await Promise.all(
      deleted.message_ids.map((id) => messageCache.get(connectionId, deleted.chat.id, id))
    )
  ).filter((m): m is CachedMessage => m !== null);

  if (found.length === 0) return;

  const botUsername = ctx.me.username;
  const senderName = escapeHtml(found[0].senderName);
  const senderUsername = escapeHtml(found[0].senderUsername ?? 'unknown');

  if (found.length === 1) {
    const original = found[0];
    const content = escapeHtml(original.text ?? original.caption ?? '');
    const uname = original.senderUsername ? ` (@${senderUsername})` : '';

    const buildCaption = () => {
      let text = `<b>${senderName}</b>${uname} удалил(а) сообщение:`;
      if (content) text += `\n\n<blockquote>${content}</blockquote>`;
      text += `\n\n@${botUsername}`;
      return text;
    };

    if (original.mediaFileId && original.mediaType && ['photo', 'video', 'document', 'voice'].includes(original.mediaType)) {
      const opts = { caption: buildCaption(), parse_mode: 'HTML' as const };
      switch (original.mediaType) {
        case 'photo': await ctx.api.sendPhoto(ownerId, original.mediaFileId, opts); break;
        case 'video': await ctx.api.sendVideo(ownerId, original.mediaFileId, opts); break;
        case 'document': await ctx.api.sendDocument(ownerId, original.mediaFileId, opts); break;
        case 'voice': await ctx.api.sendVoice(ownerId, original.mediaFileId, opts); break;
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
      `<b>${senderName}</b> (@${senderUsername}) удалил(а) <b>${found.length}</b> сообщений\n\n@${botUsername}`,
      { parse_mode: 'HTML', reply_markup: keyboard }
    );
  }

  // Логируем в очередь (не блокирует)
  for (const original of found) {
    queueSpyLog({
      user_id: ownerId,
      chat_id: deleted.chat.id,
      message_id: original.messageId,
      event_type: 'deleted',
      original_text: original.text ?? original.caption,
      media_file_id: original.mediaFileId,
      sender_id: original.senderId,
      sender_name: original.senderName,
    });
  }

  // Чистим кэш параллельно
  await Promise.all(
    found.map((o) => messageCache.del(connectionId, deleted.chat.id, o.messageId))
  );
});

// Обработка кнопки "Показать" для batch удалений
spyModule.callbackQuery(/^show_deleted:(\d+)$/, async (ctx) => {
  const batchId = ctx.match![1];
  const userId = ctx.from!.id;

  // getDeletedBatch проверяет ownerId — чужой batchId вернёт null
  const batch = await messageCache.getDeletedBatch(userId, batchId);
  if (!batch || batch.length === 0) {
    await ctx.answerCallbackQuery('Данные истекли');
    return;
  }

  await ctx.answerCallbackQuery();

  const botUsername = ctx.me.username;

  for (const msg of batch) {
    const name = escapeHtml(msg.senderName);
    const uname = escapeHtml(msg.senderUsername ?? 'unknown');
    const content = escapeHtml(msg.text ?? msg.caption ?? '');

    const buildCaption = () => {
      let text = `<b>${name}</b> (@${uname}) удалил(а):`;
      if (content) text += `\n\n<blockquote>${content}</blockquote>`;
      text += `\n\n@${botUsername}`;
      return text;
    };

    try {
      if (msg.mediaFileId && msg.mediaType && ['photo', 'video', 'document', 'voice'].includes(msg.mediaType)) {
        const opts = { caption: buildCaption(), parse_mode: 'HTML' as const };
        switch (msg.mediaType) {
          case 'photo': await ctx.api.sendPhoto(userId, msg.mediaFileId, opts); break;
          case 'video': await ctx.api.sendVideo(userId, msg.mediaFileId, opts); break;
          case 'document': await ctx.api.sendDocument(userId, msg.mediaFileId, opts); break;
          case 'voice': await ctx.api.sendVoice(userId, msg.mediaFileId, opts); break;
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
      // Rate-limit: Telegram позволяет ~30 msg/sec в разные чаты, в один чат 1/sec
      await new Promise((r) => setTimeout(r, 50));
    } catch (err: any) {
      if (err.error_code === 429) {
        const wait = err.parameters?.retry_after ?? 3;
        await new Promise((r) => setTimeout(r, wait * 1000));
      }
    }
  }
});
