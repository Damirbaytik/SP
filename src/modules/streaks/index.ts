import { Composer } from 'grammy';
import type { BotContext } from '../../types.js';
import { redis } from '../../services/redis.js';
import { supabase } from '../../services/supabase.js';

export const streaksModule = new Composer<BotContext>();

// Обновляем стрик при каждом business-сообщении от владельца
streaksModule.on('business_message', async (ctx, next) => {
  const msg = ctx.businessMessage!;
  const connectionId = msg.business_connection_id;
  if (!connectionId) return next();

  // Получаем владельца
  const { data: bc } = await supabase
    .from('business_connections')
    .select('user_id')
    .eq('id', connectionId)
    .single();

  if (!bc) return next();

  // Проверяем, обновляли ли стрик сегодня (через Redis для скорости)
  const today = new Date().toISOString().slice(0, 10);
  const streakKey = `streak:${bc.user_id}`;
  const lastDate = await redis.get(streakKey);

  if (lastDate === today) return next(); // Уже обновлено сегодня

  // Обновляем стрик
  const { data: user } = await supabase
    .from('users')
    .select('streak_days, streak_last_date')
    .eq('id', bc.user_id)
    .single();

  if (!user) return next();

  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const newStreak = user.streak_last_date === yesterday ? user.streak_days + 1 : 1;

  await supabase
    .from('users')
    .update({ streak_days: newStreak, streak_last_date: today })
    .eq('id', bc.user_id);

  // Кэшируем в Redis до конца дня
  await redis.set(streakKey, today, 'EX', 86400);

  // Уведомляем о milestone
  if ([7, 30, 100, 365].includes(newStreak)) {
    await ctx.api.sendMessage(bc.user_id, `🔥 Стрик: ${newStreak} дней подряд!`);
  }

  return next();
});
