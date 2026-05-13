import { Composer, InlineKeyboard } from 'grammy';
import type { BotContext } from '../../types.js';
import { supabase } from '../../services/supabase.js';

export const commandsModule = new Composer<BotContext>();

commandsModule.command('start', async (ctx) => {
  const userId = ctx.from!.id;
  const args = ctx.match;

  // Upsert пользователя
  const referralCode = `ref_${userId}`;
  await supabase.from('users').upsert({
    id: userId,
    username: ctx.from!.username,
    first_name: ctx.from!.first_name,
    referral_code: referralCode,
  }, { onConflict: 'id' });

  // Обработка реферальной ссылки
  if (args?.startsWith('ref_')) {
    const referrerId = parseInt(args.replace('ref_', ''));
    if (referrerId && referrerId !== userId) {
      const { data: existing } = await supabase
        .from('referrals')
        .select('id')
        .eq('referred_id', userId)
        .single();

      if (!existing) {
        await supabase.from('users').update({ referred_by: referrerId }).eq('id', userId);
        await supabase.from('referrals').insert({ referrer_id: referrerId, referred_id: userId });
      }
    }
  }

  const botUsername = ctx.me.username;

  const keyboard = new InlineKeyboard()
    .add({ text: '🔗 Подключить', url: 'tg://settings/edit', style: 'success' })
    .row()
    .add({ text: '📋 Скопировать username', copy_text: { text: `@${botUsername}` } });

  await ctx.replyWithPhoto(
    'https://i.imgur.com/placeholder.png', // TODO: заменить на реальный file_id
    {
      caption:
        '👋 Привет! Я <b>SpyDialogBot</b>.\n\n' +
        '🕵️ Подключи меня как бизнес-бота и получи суперспособности:\n\n' +
        '• Ловлю удалённые и изменённые сообщения\n' +
        '• Сохраняю медиа с таймером\n' +
        '• Живые анимации в чатах\n' +
        '• Стрики активности\n\n' +
        'Нажми <b>«Подключить»</b> чтобы начать 👇',
      parse_mode: 'HTML',
      reply_markup: keyboard,
    }
  );
});

commandsModule.callbackQuery('copy:username', async (ctx) => {
  const botUsername = ctx.me.username;
  await ctx.answerCallbackQuery({ text: `@${botUsername}`, show_alert: true });
});

commandsModule.command('settings', async (ctx) => {
  const userId = ctx.from!.id;
  const { data: settings } = await supabase
    .from('user_settings')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (!settings) {
    await ctx.reply('⚠️ Сначала подключи бизнес-бота в настройках Telegram.');
    return;
  }

  const keyboard = new InlineKeyboard()
    .text(`${settings.spy_enabled ? '✅' : '❌'} Spy-модуль`, 'toggle:spy_enabled')
    .row()
    .text(`${settings.animations_enabled ? '✅' : '❌'} Анимации`, 'toggle:animations_enabled')
    .row()
    .text(`${settings.streaks_enabled ? '✅' : '❌'} Стрики`, 'toggle:streaks_enabled');

  await ctx.reply('⚙️ Настройки:', { reply_markup: keyboard });
});

commandsModule.callbackQuery(/^toggle:(.+)$/, async (ctx) => {
  const field = ctx.match![1];
  const userId = ctx.from!.id;

  const { data: settings } = await supabase
    .from('user_settings')
    .select(field)
    .eq('user_id', userId)
    .single();

  if (!settings) return ctx.answerCallbackQuery('Ошибка');

  const newValue = !(settings as any)[field];
  await supabase
    .from('user_settings')
    .update({ [field]: newValue, updated_at: new Date().toISOString() })
    .eq('user_id', userId);

  await ctx.answerCallbackQuery(`${newValue ? 'Включено' : 'Выключено'}`);

  // Обновляем клавиатуру
  const { data: updated } = await supabase
    .from('user_settings')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (!updated) return;

  const keyboard = new InlineKeyboard()
    .text(`${updated.spy_enabled ? '✅' : '❌'} Spy-модуль`, 'toggle:spy_enabled')
    .row()
    .text(`${updated.animations_enabled ? '✅' : '❌'} Анимации`, 'toggle:animations_enabled')
    .row()
    .text(`${updated.streaks_enabled ? '✅' : '❌'} Стрики`, 'toggle:streaks_enabled');

  await ctx.editMessageReplyMarkup({ reply_markup: keyboard });
});

commandsModule.command('referral', async (ctx) => {
  const userId = ctx.from!.id;
  const { data: user } = await supabase
    .from('users')
    .select('referral_code, stars_balance')
    .eq('id', userId)
    .single();

  if (!user) return;

  const { count } = await supabase
    .from('referrals')
    .select('*', { count: 'exact', head: true })
    .eq('referrer_id', userId);

  const botUsername = ctx.me.username;
  const link = `https://t.me/${botUsername}?start=${user.referral_code}`;

  await ctx.reply(
    `👥 <b>Реферальная программа</b>\n\n` +
    `Твоя ссылка: <code>${link}</code>\n\n` +
    `Приглашено: ${count ?? 0} чел.\n` +
    `Бонус Stars: ${user.stars_balance}\n\n` +
    `За каждую оплату реферала ты получаешь 10% бонус!`,
    { parse_mode: 'HTML' }
  );
});
