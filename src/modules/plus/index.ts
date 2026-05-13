import { Composer, InlineKeyboard } from 'grammy';
import type { BotContext } from '../../types.js';
import {
  getActivePlans,
  getPlanByCode,
  getSubscriptionStatus,
  activateTrial,
  extendSubscription,
} from '../../services/subscriptions.js';
import { getConfig } from '../../services/config.js';
import { supabase } from '../../services/supabase.js';

export const plusModule = new Composer<BotContext>();

plusModule.command('plus', async (ctx) => {
  await renderPlusMenu(ctx);
});

export async function renderPlusMenu(ctx: BotContext) {
  const userId = ctx.from!.id;

  // Параллельные запросы для скорости
  const [status, plans, { data: userData }] = await Promise.all([
    getSubscriptionStatus(userId),
    getActivePlans(),
    supabase.from('users').select('trial_used').eq('id', userId).single(),
  ]);

  let text = '💎 <b>Подписка Plus</b>\n\n';

  if (status.active) {
    const expStr = status.expiresAt?.toLocaleDateString('ru') ?? '—';
    text += `✅ Активна до <b>${expStr}</b>\n`;
    if (status.isTrial) text += '🎁 Пробный период\n';
    text += `Осталось дней: ${status.daysLeft}\n\n`;
  } else {
    const trialDays = await getConfig<number>('trial_days', 3);
    if (!userData?.trial_used) {
      text += `🎁 Получи <b>${trialDays} дней бесплатно</b> прямо сейчас\n\n`;
    } else {
      text += 'Подписка неактивна\n\n';
    }
  }

  text += '<b>Доступные тарифы:</b>\n';
  for (const p of plans) {
    text += `• <b>${p.title}</b> — ${p.price_stars} ⭐ / ${p.price_rub}₽\n`;
  }

  const keyboard = new InlineKeyboard();

  // Пробный период
  if (!status.active && !userData?.trial_used) {
    keyboard.text('🎁 Активировать пробный период', 'plus:trial').row();
  }

  // Тарифы Stars
  for (const p of plans) {
    keyboard.text(`⭐ ${p.title} — ${p.price_stars}`, `plus:buy_stars:${p.code}`).row();
  }
  // Карта — только месяц, после всех Stars
  const monthPlan = plans.find(p => p.code === 'month');
  if (monthPlan) {
    keyboard.text(`💳 Месяц • Банковская карта`, `plus:buy_card:month`).row();
  }

  keyboard.add({ text: '👥 Пригласи друга', callback_data: 'plus:referral', style: 'primary' }).row();
  keyboard.text('⬅️ Назад', 'start:back');

  await ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboard });
}

// Активация trial
plusModule.callbackQuery('plus:trial', async (ctx) => {
  const userId = ctx.from!.id;
  const result = await activateTrial(userId);

  if (!result.success) {
    await ctx.answerCallbackQuery('❌ Пробный период уже использован');
    return;
  }

  await ctx.answerCallbackQuery(`✅ Активировано на ${result.days} дней`);
  await ctx.reply(
    `🎁 <b>Пробный период активирован!</b>\n\n` +
    `Все функции Pro доступны на <b>${result.days} дней</b>.\n` +
    `После окончания можешь оформить подписку.`,
    { parse_mode: 'HTML' }
  );
});

// Реферальная ссылка
plusModule.callbackQuery('plus:referral', async (ctx) => {
  await ctx.answerCallbackQuery();
  const userId = ctx.from!.id;
  const botUsername = ctx.me.username;

  const { data: user } = await supabase.from('users').select('referral_code').eq('id', userId).single();
  const code = user?.referral_code ?? `ref_${userId}`;
  const link = `https://t.me/${botUsername}?start=${code}`;

  const { count } = await supabase.from('referrals').select('*', { count: 'exact', head: true }).eq('referrer_id', userId);
  const daysReferrer = await getConfig<number>('referral_days_per_invite', 7);
  const daysReferred = await getConfig<number>('referral_days_for_referred', 7);

  await ctx.reply(
    `👥 <b>Пригласи друга</b>\n\n` +
    `Поделись ссылкой и получи <b>${daysReferrer} дней</b> Plus!\nТвой друг получит <b>${daysReferred} дней</b>.\n\n` +
    `Твоя ссылка:\n<code>${link}</code>\n\n` +
    `Приглашено: <b>${count ?? 0}</b> чел.`,
    { parse_mode: 'HTML', reply_markup: new InlineKeyboard().url('\u{1F4E8} Поделиться', 'https://t.me/share/url?url=' + encodeURIComponent(link) + '&text=' + encodeURIComponent('Подключи SpyDialogBot и получи ' + daysReferred + ' дней Plus!')) }
  );
});

// Покупка через Stars
plusModule.callbackQuery(/^plus:buy_stars:(.+)$/, async (ctx) => {
  const code = ctx.match![1];
  const plan = await getPlanByCode(code);
  if (!plan) return ctx.answerCallbackQuery('Тариф не найден');

  await ctx.answerCallbackQuery();
  await ctx.replyWithInvoice(
    `Подписка Plus — ${plan.title}`,
    `${plan.days} дней доступа ко всем функциям`,
    `plan_${plan.code}`,
    'XTR',
    [{ label: plan.title, amount: plan.price_stars }]
  );
});

// Покупка картой (Tribute)
plusModule.callbackQuery(/^plus:buy_card:(.+)$/, async (ctx) => {
  const code = ctx.match![1];
  const plan = await getPlanByCode(code);
  if (!plan) return ctx.answerCallbackQuery('Тариф не найден');

  const providerToken = await getConfig<string>('card_provider_token', '');
  if (!providerToken) {
    await ctx.answerCallbackQuery({ text: '💳 Оплата картой пока не настроена', show_alert: true });
    return;
  }

  await ctx.answerCallbackQuery();
  await ctx.replyWithInvoice(
    `Подписка Plus — ${plan.title}`,
    `${plan.days} дней доступа ко всем функциям`,
    `plan_${plan.code}_card`,
    'RUB',
    [{ label: plan.title, amount: plan.price_rub * 100 }], // копейки
    { provider_token: providerToken }
  );
});

// Обработка платежей
plusModule.on('pre_checkout_query', async (ctx) => {
  await ctx.answerPreCheckoutQuery(true);
});

plusModule.on(':successful_payment', async (ctx) => {
  const payment = ctx.message!.successful_payment!;
  const userId = ctx.from!.id;

  // Извлекаем код плана из payload
  const match = payment.invoice_payload.match(/^plan_([a-z]+)/);
  const code = match?.[1];
  const plan = code ? await getPlanByCode(code) : null;
  if (!plan) return;

  const isCard = payment.invoice_payload.includes('_card');
  const method = isCard ? 'card' : 'stars';

  // Продлеваем подписку
  await extendSubscription(userId, plan.days, 'pro');

  // Записываем платёж
  await supabase.from('payments').insert({
    user_id: userId,
    amount: payment.total_amount,
    currency: payment.currency,
    plan: 'pro',
    plan_id: plan.id,
    duration_days: plan.days,
    payment_method: method,
    telegram_payment_charge_id: payment.telegram_payment_charge_id,
    provider_payment_charge_id: payment.provider_payment_charge_id,
    status: 'completed',
  });

  // Реферальный бонус — если этот юзер был приглашён
  const { data: user } = await supabase.from('users').select('referred_by').eq('id', userId).single();

  if (user?.referred_by) {
    // Проверяем, первая ли это оплата (чтобы не начислять бонус несколько раз)
    const { count } = await supabase
      .from('payments')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('status', 'completed');

    if (count === 1) {
      const bonusDays = await getConfig<number>('referral_paid_bonus_days', 14);
      await extendSubscription(user.referred_by, bonusDays, 'pro');
      await supabase.from('payments').insert({
        user_id: user.referred_by,
        amount: 0,
        plan: 'pro',
        plan_id: plan.id,
        duration_days: bonusDays,
        payment_method: 'referral',
        status: 'completed',
      });

      await ctx.api.sendMessage(
        user.referred_by,
        `🎉 Твой реферал оплатил подписку! Тебе начислено <b>${bonusDays} дней</b> Plus.`,
        { parse_mode: 'HTML' }
      ).catch(() => {});
    }
  }

  await ctx.reply(
    `✅ Оплата прошла!\n\nПодписка <b>${plan.title}</b> активирована на <b>${plan.days} дней</b>.`,
    { parse_mode: 'HTML' }
  );
});
