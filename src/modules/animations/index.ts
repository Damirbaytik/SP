import { Composer } from 'grammy';
import type { BotContext } from '../../types.js';
import {
  getAllAnimations,
  getAnimation,
  hasAnimationAccess,
  isAnimationCommand,
} from '../../services/animations.js';
import { getConnectionOwner } from '../../services/connection.js';
import { getUserSettings } from '../../services/settings.js';
import { redis } from '../../services/redis.js';

export const animationsModule = new Composer<BotContext>();

const MAX_FRAMES = 30;
const RATE_LIMIT_SEC = 5;

// Прогрев in-memory Set при старте (без await — в фоне)
getAllAnimations().catch(() => {});

// Обработка команд анимаций в business-сообщениях (от владельца)
animationsModule.on('business_message', async (ctx, next) => {
  const msg = ctx.businessMessage!;
  const text = msg.text?.trim();
  const connectionId = msg.business_connection_id;

  if (!text?.startsWith('.') || !connectionId) return next();

  // Парсим команду и аргумент: ".love Дамир" → cmd=".love", arg="Дамир"
  const spaceIdx = text.indexOf(' ');
  const command = (spaceIdx === -1 ? text : text.slice(0, spaceIdx)).toLowerCase();
  const arg = spaceIdx === -1 ? '' : text.slice(spaceIdx + 1).trim();

  // Quick-filter: если команды нет в in-memory Set — сразу выходим
  if (!isAnimationCommand(command)) return next();

  const ownerId = await getConnectionOwner(connectionId);
  if (!ownerId || msg.from?.id !== ownerId) return next();

  // Rate-limit: 1 анимация в 5 сек
  const rlKey = `anim_rl:${ownerId}`;
  const allowed = await redis.set(rlKey, '1', 'EX', RATE_LIMIT_SEC, 'NX');
  if (!allowed) return next();

  const settings = await getUserSettings(ownerId);
  if (!settings.animations_enabled) return next();

  const animation = await getAnimation(command);
  if (!animation) return next();

  const access = await hasAnimationAccess(ownerId, animation);
  if (!access.allowed) return next();

  // Применяем аргумент к кадрам
  const frames = applyArg(animation.frames, arg).slice(0, MAX_FRAMES);

  runAnimation(ctx, msg.chat.id, msg.message_id, frames, animation.frame_delay_ms, connectionId).catch((err) => {
    console.error('[Animations] Error:', err.message);
  });
});

// Применение аргумента: замена {arg} или добавление в конец последнего кадра
function applyArg(frames: string[], arg: string): string[] {
  if (!arg) return frames;
  // Ограничиваем длину аргумента для безопасности
  const safeArg = arg.slice(0, 100);

  const hasPlaceholder = frames.some((f) => f.includes('{arg}'));
  if (hasPlaceholder) {
    return frames.map((f) => f.replaceAll('{arg}', safeArg));
  }
  // Добавляем в конец последнего кадра
  const result = [...frames];
  result[result.length - 1] = `${result[result.length - 1]} ${safeArg}`;
  return result;
}

async function runAnimation(
  ctx: BotContext,
  chatId: number,
  messageId: number,
  frames: string[],
  delayMs: number,
  businessConnectionId: string
): Promise<void> {
  for (const frame of frames) {
    try {
      await ctx.api.editMessageText(chatId, messageId, frame, {
        business_connection_id: businessConnectionId,
      });
      await sleep(delayMs);
    } catch (err: any) {
      if (err.error_code === 429) {
        const retryAfter = err.parameters?.retry_after ?? 5;
        await sleep(retryAfter * 1000);
        continue;
      }
      break;
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
