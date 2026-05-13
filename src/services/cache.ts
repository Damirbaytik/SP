import { redis } from './redis.js';
import { config } from '../config.js';

export interface CachedMessage {
  messageId: number;
  chatId: number;
  senderId: number;
  senderName: string;
  senderUsername?: string;
  text?: string;
  caption?: string;
  mediaFileId?: string;
  mediaType?: string;
  date: number;
}

const msgKey = (connectionId: string, chatId: number, messageId: number) =>
  `msg:${connectionId}:${chatId}:${messageId}`;

const deletedBatchKey = (userId: number, batchId: string) =>
  `deleted_batch:${userId}:${batchId}`;

export const messageCache = {
  async set(connectionId: string, msg: CachedMessage): Promise<void> {
    const key = msgKey(connectionId, msg.chatId, msg.messageId);
    await redis.set(key, JSON.stringify(msg), 'EX', config.cache.messageTtl);
  },

  async get(connectionId: string, chatId: number, messageId: number): Promise<CachedMessage | null> {
    const key = msgKey(connectionId, chatId, messageId);
    const data = await redis.get(key);
    return data ? JSON.parse(data) : null;
  },

  async del(connectionId: string, chatId: number, messageId: number): Promise<void> {
    const key = msgKey(connectionId, chatId, messageId);
    await redis.del(key);
  },

  // Сохраняем batch удалённых сообщений для пагинации по кнопкам
  async setDeletedBatch(userId: number, batchId: string, messages: CachedMessage[]): Promise<void> {
    const key = deletedBatchKey(userId, batchId);
    await redis.set(key, JSON.stringify({ ownerId: userId, messages }), 'EX', 86400); // 24ч
  },

  async getDeletedBatch(userId: number, batchId: string): Promise<CachedMessage[] | null> {
    const key = deletedBatchKey(userId, batchId);
    const data = await redis.get(key);
    if (!data) return null;
    const parsed = JSON.parse(data);
    // Защита: проверяем что batch принадлежит запрашивающему
    if (parsed.ownerId !== userId) return null;
    return parsed.messages;
  },
};
