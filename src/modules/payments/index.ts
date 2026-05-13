import { Composer, InlineKeyboard } from 'grammy';
import type { BotContext } from '../../types.js';
import { supabase } from '../../services/supabase.js';

export const paymentsModule = new Composer<BotContext>();

const PLANS = {
  basic: { stars: 100, days: 30, label: 'Basic (30 дней)' },
  pro: { stars: 250, days: 30, label: 'Pro (30 дней)' },
} as const;

// Команда /subscribe
paymentsModule.command('subscribe', async (ctx) => {
  const keyboard = new InlineKeyboard()
    .text(`⭐ Basic — ${PLANS.basic.stars} Stars`, 'buy:basic')
    .row()
    .text(`⭐ Pro — ${PLANS.pro.stars} Stars`, 'buy:pro');

  await ctx.reply(
    '💎 Выбери план подписки:\n\n' +
    '• Basic — Spy + сохранение медиа\n' +
    '• Pro — всё из Basic + анимации + приоритет',
    { reply_markup: keyboard }
  );
});

// Обработка нажатия на кнопку покупки
paymentsModule.callbackQuery(/^buy:(basic|pro)$/, async (ctx) => {
  const plan = ctx.match![1] as 'basic' | 'pro';
  const { stars, label } = PLANS[plan];

  await ctx.answerCallbackQuery();
  await ctx.replyWithInvoice(
    `Подписка ${label}`,
    `Активация плана ${label}`,
    `plan_${plan}_30d`,
    'XTR',
    [{ label, amount: stars }]
  );
});

// Обработка успешной оплаты
paymentsModule.on('pre_checkout_query', async (ctx) => {
  await ctx.answerPreCheckoutQuery(true);
});

paymentsModule.on(':successful_payment', async (ctx) => {
  const payment = ctx.message!.successful_payment!;
  const userId = ctx.from!.id;
  const plan = payment.invoice_payload.includes('pro') ? 'pro' : 'basic';
  const days = PLANS[plan].days;

  const expiresAt = new Date(Date.now() + days * 86400000).toISOString();

  // Обновляем подписку
  await supabase
    .from('users')
    .update({ subscription_plan: plan, subscription_expires_at: expiresAt })
    .eq('id', userId);

  // Записываем платёж
  await supabase.from('payments').insert({
    user_id: userId,
    amount: payment.total_amount,
    plan,
    duration_days: days,
    telegram_payment_charge_id: payment.telegram_payment_charge_id,
    provider_payment_charge_id: payment.provider_payment_charge_id,
    status: 'completed',
  });

  // Начисляем бонус рефереру
  const { data: user } = await supabase
    .from('users')
    .select('referred_by')
    .eq('id', userId)
    .single();

  if (user?.referred_by) {
    const bonus = Math.floor(payment.total_amount * 0.1); // 10% реферальный бонус
    await supabase.rpc('increment_stars', { user_id: user.referred_by, amount: bonus }).catch(() => {});
  }

  await ctx.reply(`✅ Подписка ${plan.toUpperCase()} активирована до ${new Date(expiresAt).toLocaleDateString('ru')}!`);
});
