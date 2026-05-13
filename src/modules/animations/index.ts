import { Composer } from 'grammy';
import type { BotContext } from '../../types.js';
import { supabase } from '../../services/supabase.js';

export const animationsModule = new Composer<BotContext>();

// Обработка команд анимаций в business-сообщениях (от владельца)
animationsModule.on('business_message', async (ctx, next) => {
  const msg = ctx.businessMessage!;
  const text = msg.text?.trim();

  if (!text?.startsWith('.')) return next();

  const command = text.toLowerCase();

  const { data: animation } = await supabase
    .from('animations')
    .select('*')
    .eq('command', command)
    .single();

  if (!animation) return next();

  // Запускаем анимацию в фоне, не блокируя обработку
  runAnimation(ctx, msg.chat.id, msg.message_id, animation.frames, animation.frame_delay_ms, msg.business_connection_id).catch((err) => {
    console.error('[Animations] Error:', err.message);
  });
});

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
      // Если FloodWait — ждём и продолжаем
      if (err.error_code === 429) {
        const retryAfter = err.parameters?.retry_after ?? 5;
        await sleep(retryAfter * 1000);
        continue;
      }
      // Другие ошибки — прекращаем анимацию
      break;
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
