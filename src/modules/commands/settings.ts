import { InlineKeyboard } from 'grammy';
import type { BotContext } from '../../types.js';
import { supabase } from '../../services/supabase.js';
import { invalidateSettings } from '../../services/settings.js';
import { commandsModule } from './index.js';

function settingsKb(s: any) {
  return new InlineKeyboard()
    .text(`${s.notify_edited ? '\u2705' : '\u274C'} \u0420\u0435\u0434\u0430\u043A\u0442\u0438\u0440\u043E\u0432\u0430\u043D\u0438\u0435`, 'toggle:notify_edited').row()
    .text(`${s.notify_deleted ? '\u2705' : '\u274C'} \u0423\u0434\u0430\u043B\u0435\u043D\u0438\u0435`, 'toggle:notify_deleted').row()
    .text(`${s.notify_timer_media ? '\u2705' : '\u274C'} \u041C\u0435\u0434\u0438\u0430 \u0441 \u0442\u0430\u0439\u043C\u0435\u0440\u043E\u043C`, 'toggle:notify_timer_media').row()
    .text(`${s.animations_enabled ? '\u2705' : '\u274C'} \u0410\u043D\u0438\u043C\u0430\u0446\u0438\u0438`, 'toggle:animations_enabled').row()
    .text('\u2B05\uFE0F \u041D\u0430\u0437\u0430\u0434', 'start:back');
}

commandsModule.callbackQuery('start:settings', async (ctx) => {
  await ctx.answerCallbackQuery();
  const userId = ctx.from!.id;
  const { data: s } = await supabase.from('user_settings').select('*').eq('user_id', userId).single();
  if (!s) { await ctx.reply('\u26A0\uFE0F \u0421\u043D\u0430\u0447\u0430\u043B\u0430 \u043F\u043E\u0434\u043A\u043B\u044E\u0447\u0438 \u0431\u0438\u0437\u043D\u0435\u0441-\u0431\u043E\u0442\u0430.'); return; }
  await ctx.reply('\u2699\uFE0F \u041D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0438:', { reply_markup: settingsKb(s) });
});

commandsModule.callbackQuery(/^toggle:(.+)$/, async (ctx) => {
  const field = ctx.match![1];
  const userId = ctx.from!.id;
  const { data: s } = await supabase.from('user_settings').select(field).eq('user_id', userId).single();
  if (!s) return ctx.answerCallbackQuery('\u041E\u0448\u0438\u0431\u043A\u0430');
  const nv = !(s as any)[field];
  await supabase.from('user_settings').update({ [field]: nv, updated_at: new Date().toISOString() }).eq('user_id', userId);
  await invalidateSettings(userId);
  await ctx.answerCallbackQuery(nv ? '\u0412\u043A\u043B\u044E\u0447\u0435\u043D\u043E' : '\u0412\u044B\u043A\u043B\u044E\u0447\u0435\u043D\u043E');
  const { data: u } = await supabase.from('user_settings').select('*').eq('user_id', userId).single();
  if (!u) return;
  await ctx.editMessageReplyMarkup({ reply_markup: settingsKb(u) });
});
