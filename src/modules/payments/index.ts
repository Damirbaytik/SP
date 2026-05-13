import { Composer } from 'grammy';
import type { BotContext } from '../../types.js';

export const paymentsModule = new Composer<BotContext>();

// Старые callbacks buy:basic/buy:pro — перенаправляем на /plus
paymentsModule.callbackQuery(/^buy:(basic|pro)$/, async (ctx) => {
  await ctx.answerCallbackQuery({ text: 'Используй /plus для покупки подписки', show_alert: true });
});
