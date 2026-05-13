import { Composer, InlineKeyboard } from 'grammy';
import type { BotContext } from '../../types.js';
import { supabase } from '../../services/supabase.js';
import { invalidateSettings } from '../../services/settings.js';

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
    .add({ text: '🎬 Анимации', callback_data: 'start:animations', style: 'danger' })
    .add({ text: '📋 Скопировать username', copy_text: { text: `@${botUsername}` }, style: 'primary' })
    .row()
    .add({ text: '▶️ Демонстрация работы бота', callback_data: 'start:demo', style: 'primary' })
    .row()
    .add({ text: '💎 Подписка', callback_data: 'start:subscribe', style: 'primary' })
    .add({ text: '⚙️ Настройки', callback_data: 'start:settings', style: 'primary' });

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

// Кнопка "Анимации" — открывает меню анимаций
commandsModule.callbackQuery('start:animations', async (ctx) => {
  await ctx.answerCallbackQuery();

  const { getAllAnimations, CATEGORIES } = await import('../../services/animations.js');
  const { redis } = await import('../../services/redis.js');
  const all = await getAllAnimations(); // из Redis-кэша — быстро
  const userId = ctx.from!.id;

  // Кэшируем данные пользователя в Redis на 5 мин
  const userCacheKey = `user_access:${userId}`;
  let hasActivePro = false;
  let refs = 0;

  const cached = await redis.get(userCacheKey);
  if (cached) {
    const parsed = JSON.parse(cached);
    hasActivePro = parsed.pro;
    refs = parsed.refs;
  } else {
    const [{ data: user }, { count: refCount }] = await Promise.all([
      supabase.from('users').select('subscription_plan, subscription_expires_at').eq('id', userId).single(),
      supabase.from('referrals').select('*', { count: 'exact', head: true }).eq('referrer_id', userId),
    ]);

    hasActivePro =
      user?.subscription_plan === 'pro' &&
      user?.subscription_expires_at &&
      new Date(user.subscription_expires_at) > new Date();

    refs = refCount ?? 0;
    await redis.set(userCacheKey, JSON.stringify({ pro: hasActivePro, refs }), 'EX', 300);
  }

  const stats = new Map<string, { total: number; available: number }>();
  for (const anim of all) {
    const s = stats.get(anim.category) ?? { total: 0, available: 0 };
    s.total++;
    const allowed =
      anim.unlock_type === 'free' ||
      (anim.unlock_type === 'premium' && hasActivePro) ||
      (anim.unlock_type === 'referrals' && refs >= anim.unlock_threshold);
    if (allowed) s.available++;
    stats.set(anim.category, s);
  }

  const totalAvailable = Array.from(stats.values()).reduce((a, s) => a + s.available, 0);

  let text = `🎬 <b>Анимации</b> (${totalAvailable}/${all.length})\n\nВыбери категорию:\n\n`;
  for (const [key, info] of Object.entries(CATEGORIES)) {
    const s = stats.get(key) ?? { total: 0, available: 0 };
    if (s.total === 0) continue;
    text += `${info.emoji} ${info.title} — ${s.available}/${s.total}\n`;
  }

  const keyboard = new InlineKeyboard();
  for (const key of Object.keys(CATEGORIES) as Array<keyof typeof CATEGORIES>) {
    const s = stats.get(key);
    if (!s || s.total === 0) continue;
    keyboard.text(CATEGORIES[key].emoji, `anim_cat:${key}`);
  }

  await ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboard });
});

// Кнопка "Демонстрация" — видео + текст + кнопки
commandsModule.callbackQuery('start:demo', async (ctx) => {
  await ctx.answerCallbackQuery();

  const botUsername = ctx.me.username;
  const text =
    '▶️ <b>Демонстрация работы</b>\n\n' +
    'Бот автоматически ловит удалённые и изменённые сообщения собеседника и присылает тебе оригинал.\n\n' +
    'Также можно сохранять фото/видео с таймером — просто ответь на них.';

  const keyboard = new InlineKeyboard()
    .add({ text: '📖 Туториал', callback_data: 'start:tutorial', style: 'danger' })
    .row()
    .text('⬅️ Назад', 'start:back');

  // TODO: заменить на реальный file_id видео
  await ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboard });
});

// Кнопка "Туториал" — видео + текст + кнопки
commandsModule.callbackQuery('start:tutorial', async (ctx) => {
  await ctx.answerCallbackQuery();

  const botUsername = ctx.me.username;
  const text =
    '📖 <b>Как подключить бота</b>\n\n' +
    '1. Открой настройки Telegram → Telegram Business\n' +
    '2. Выбери "Чат-боты"\n' +
    `3. Вставь <code>@${botUsername}</code>\n` +
    '4. Готово — бот активирован!\n\n' +
    'После подключения бот работает автоматически.';

  const keyboard = new InlineKeyboard()
    .text('⬅️ Назад', 'start:back')
    .add({ text: '📋 Скопировать username', copy_text: { text: `@${botUsername}` }, style: 'primary' });

  // TODO: заменить на реальный file_id видео
  await ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboard });
});

// Кнопка "Назад" — возвращает стартовое сообщение
commandsModule.callbackQuery('start:back', async (ctx) => {
  await ctx.answerCallbackQuery();

  const botUsername = ctx.me.username;
  const keyboard = new InlineKeyboard()
    .add({ text: '🔗 Подключить', url: 'tg://settings/edit', style: 'success' })
    .row()
    .add({ text: '🎬 Анимации', callback_data: 'start:animations', style: 'danger' })
    .add({ text: '📋 Скопировать username', copy_text: { text: `@${botUsername}` }, style: 'primary' })
    .row()
    .add({ text: '▶️ Демонстрация работы бота', callback_data: 'start:demo', style: 'primary' })
    .row()
    .add({ text: '💎 Подписка', callback_data: 'start:subscribe', style: 'primary' })
    .add({ text: '⚙️ Настройки', callback_data: 'start:settings', style: 'primary' });

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

// Кнопка "Подписка"
commandsModule.callbackQuery('start:subscribe', async (ctx) => {
  await ctx.answerCallbackQuery();

  const keyboard = new InlineKeyboard()
    .text('⭐ Basic — 100 Stars', 'buy:basic')
    .row()
    .text('⭐ Pro — 250 Stars', 'buy:pro')
    .row()
    .text('⬅️ Назад', 'start:back');

  await ctx.reply(
    '💎 <b>Подписка</b>\n\n' +
    '• <b>Basic</b> — Spy + сохранение медиа\n' +
    '• <b>Pro</b> — всё из Basic + анимации + приоритет',
    { parse_mode: 'HTML', reply_markup: keyboard }
  );
});

// Кнопка "Настройки"
commandsModule.callbackQuery('start:settings', async (ctx) => {
  await ctx.answerCallbackQuery();
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
    .text(`${settings.notify_edited ? '✅' : '❌'} Редактирование`, 'toggle:notify_edited')
    .row()
    .text(`${settings.notify_deleted ? '✅' : '❌'} Удаление`, 'toggle:notify_deleted')
    .row()
    .text(`${settings.notify_timer_media ? '✅' : '❌'} Медиа с таймером`, 'toggle:notify_timer_media')
    .row()
    .text(`${settings.animations_enabled ? '✅' : '❌'} Анимации`, 'toggle:animations_enabled')
    .row()
    .text(`${settings.streaks_enabled ? '✅' : '❌'} Стрики`, 'toggle:streaks_enabled')
    .row()
    .text('⬅️ Назад', 'start:back');

  await ctx.reply('⚙️ Настройки:', { reply_markup: keyboard });
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
    .text(`${settings.notify_edited ? '✅' : '❌'} Редактирование`, 'toggle:notify_edited')
    .row()
    .text(`${settings.notify_deleted ? '✅' : '❌'} Удаление`, 'toggle:notify_deleted')
    .row()
    .text(`${settings.notify_timer_media ? '✅' : '❌'} Медиа с таймером`, 'toggle:notify_timer_media')
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

  // Инвалидация кэша настроек
  await invalidateSettings(userId);

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
    .text(`${updated.notify_edited ? '✅' : '❌'} Редактирование`, 'toggle:notify_edited')
    .row()
    .text(`${updated.notify_deleted ? '✅' : '❌'} Удаление`, 'toggle:notify_deleted')
    .row()
    .text(`${updated.notify_timer_media ? '✅' : '❌'} Медиа с таймером`, 'toggle:notify_timer_media')
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
