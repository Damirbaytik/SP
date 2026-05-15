import { Composer } from 'grammy';
import type { BotContext } from '../../types.js';
import { getConnectionOwner } from '../../services/connection.js';
import { logMessage, updateMessageStatus } from '../../services/chat_logger.js';

export const chatLogModule = new Composer<BotContext>();

function detectKind(msg: any): string {
  const raw = msg;
  const isTimer = raw.has_media_spoiler || raw.has_protected_content;
  if (msg.photo) return isTimer ? 'photo_timer' : 'photo';
  if (msg.video) return isTimer ? 'video_timer' : 'video';
  if (msg.voice) return 'voice';
  if (msg.video_note) return 'video_note';
  if (msg.document) return 'document';
  if (msg.sticker) return 'sticker';
  return 'text';
}

function extractFileId(msg: any): string | undefined {
  return msg.photo?.at(-1)?.file_id
    ?? msg.video?.file_id
    ?? msg.document?.file_id
    ?? msg.voice?.file_id
    ?? msg.video_note?.file_id
    ?? msg.sticker?.file_id;
}

chatLogModule.on('business_message', async (ctx, next) => {
  const msg = ctx.businessMessage!;
  const connectionId = msg.business_connection_id;
  if (!connectionId) return next();

  const ownerId = await getConnectionOwner(connectionId);
  if (!ownerId) return next();

  const fromMe = msg.from?.id === ownerId;

  let chatName: string | undefined;
  let chatUsername: string | undefined;
  if (fromMe) {
    chatName = (msg.chat as any).first_name ?? (msg.chat as any).title;
    chatUsername = (msg.chat as any).username;
  } else {
    chatName = msg.from?.first_name;
    chatUsername = msg.from?.username;
  }

  logMessage({
    owner_id: ownerId,
    connection_id: connectionId,
    chat_id: msg.chat.id,
    chat_name: chatName,
    chat_username: chatUsername,
    message_id: msg.message_id,
    sender_id: msg.from?.id ?? 0,
    sender_name: msg.from?.first_name,
    sender_username: msg.from?.username,
    from_me: fromMe,
    text: msg.text ?? msg.caption ?? undefined,
    kind: detectKind(msg),
    status: 'normal',
    media_file_id: extractFileId(msg),
    reply_to_message_id: msg.reply_to_message?.message_id,
  });

  return next();
});

chatLogModule.on('edited_business_message', async (ctx, next) => {
  const msg = ctx.editedBusinessMessage!;
  const connectionId = msg.business_connection_id;
  if (!connectionId) return next();

  const newText = msg.text ?? msg.caption ?? '';

  await updateMessageStatus(
    connectionId,
    msg.chat.id,
    msg.message_id,
    'edited',
    newText
  );

  return next();
});

chatLogModule.on('deleted_business_messages', async (ctx, next) => {
  const deleted = ctx.deletedBusinessMessages!;
  const connectionId = deleted.business_connection_id;

  for (const messageId of deleted.message_ids) {
    await updateMessageStatus(connectionId, deleted.chat.id, messageId, 'deleted');
  }

  return next();
});
