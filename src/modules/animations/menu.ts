import { Composer, InlineKeyboard } from 'grammy';
import type { BotContext } from '../../types.js';
import {
  getAllAnimations,
  getAnimation,
  hasAnimationAccess,
  CATEGORIES,
} from '../../services/animations.js';
import { escapeHtml } from '../../services/utils.js';
import { redis } from '../../services/redis.js';

export const animationsMenu = new Composer<BotContext>();

// URL статьи с инструкцией (telegra.ph)
const HELP_URL = 'https://telegra.ph/SpyDialogBot-Animacii-01-01'; // TODO: заменить на реальную

// Команда /animations — главное меню
animationsMenu.command('animations', async (ctx) => {
  await renderMainMenu(ctx, ctx.from!.id);
});

async function renderMainMenu(ctx: BotContext, userId: number, edit = false) {
  const all = await getAllAnimations();

  const stats = new Map<string, { total: number; available: number }>();
  for (const anim of all) {
    const s = stats.get(anim.category) ?? { total: 0, available: 0 };
    s.total++;
    const access = await hasAnimationAccess(userId, anim);
    if (access.allowed) s.available++;
    stats.set(anim.category, s);
  }

  const totalAvailable = Array.from(stats.values()).reduce((a, s) => a + s.available, 0);
  const totalAll = all.length;

  let text = `🎬 <b>Анимации</b> (${totalAvailable}/${totalAll})\n\n`;
  text += `Выбери категорию:\n\n`;
  for (const [key, info] of Object.entries(CATEGORIES)) {
    const s = stats.get(key) ?? { total: 0, available: 0 };
    if (s.total === 0) continue;
    text += `${info.emoji} ${info.title} — ${s.available}/${s.total}\n`;
  }

  const keyboard = new InlineKeyboard();
  const categoryKeys = Object.keys(CATEGORIES) as Array<keyof typeof CATEGORIES>;
  for (const key of categoryKeys) {
    const s = stats.get(key);
    if (!s || s.total === 0) continue;
    keyboard.text(CATEGORIES[key].emoji, `anim_cat:${key}`);
  }
  keyboard.row().url('📖 Как пользоваться', HELP_URL);

  if (edit) {
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: keyboard });
  } else {
    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboard });
  }
}

// Выбор категории
animationsMenu.callbackQuery(/^anim_cat:(.+)$/, async (ctx) => {
  const category = ctx.match![1] as keyof typeof CATEGORIES;
  const userId = ctx.from!.id;

  await ctx.answerCallbackQuery();

  const all = await getAllAnimations();
  const items = all.filter((a) => a.category === category);
  const catInfo = CATEGORIES[category];

  let text = `${catInfo.emoji} <b>${catInfo.title}</b>\n\n`;

  const keyboard = new InlineKeyboard();

  for (const anim of items) {
    const access = await hasAnimationAccess(userId, anim);
    const lock = access.allowed ? '✅' : '🔒';
    const unlockNote = !access.allowed
      ? (anim.unlock_type === 'premium'
          ? ' (Pro)'
          : ` (${access.progress?.current ?? 0}/${anim.unlock_threshold} друзей)`)
      : '';
    text += `${lock} <code>${anim.command}</code> — ${escapeHtml(anim.title)}${unlockNote}\n`;

    if (access.allowed) {
      // Доступная анимация: Демо + Копировать
      keyboard
        .text(`🎬 ${anim.emoji} Демо`, `anim_demo:${anim.command}`)
        .add({ text: `📋 ${anim.command}`, copy_text: { text: anim.command } })
        .row();
    } else {
      keyboard.text(`🔒 ${anim.command}`, `anim_locked:${anim.command}`).row();
    }
  }

  keyboard.text('⬅️ Назад', 'anim_back');

  await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: keyboard });
});

// Демо анимации — редактируем сообщение циклически
animationsMenu.callbackQuery(/^anim_demo:(.+)$/, async (ctx) => {
  const command = ctx.match![1];
  const userId = ctx.from!.id;

  // Rate-limit: один demo на пользователя раз в 10 сек
  const rlKey = `anim_demo_rl:${userId}`;
  const locked = await redis.set(rlKey, '1', 'EX', 10, 'NX');
  if (!locked) {
    await ctx.answerCallbackQuery('⏳ Подожди 10 секунд');
    return;
  }

  await ctx.answerCallbackQuery();

  const anim = await getAnimation(command);
  if (!anim) return;

  // Отправляем первый кадр
  const sent = await ctx.reply(anim.frames[0], { parse_mode: 'HTML' });

  // Прокручиваем кадры в фоне
  (async () => {
    for (let i = 1; i < anim.frames.length; i++) {
      await sleep(anim.frame_delay_ms);
      try {
        await ctx.api.editMessageText(userId, sent.message_id, anim.frames[i]);
      } catch {
        break;
      }
    }
  })().catch(() => {});
});

// Назад в главное меню
animationsMenu.callbackQuery('anim_back', async (ctx) => {
  await ctx.answerCallbackQuery();
  await renderMainMenu(ctx, ctx.from!.id, true);
});

// Инфо о заблокированной анимации
animationsMenu.callbackQuery(/^anim_locked:(.+)$/, async (ctx) => {
  const command = ctx.match![1];
  const userId = ctx.from!.id;

  await ctx.answerCallbackQuery();

  const anim = await getAnimation(command);
  if (!anim) return;

  const access = await hasAnimationAccess(userId, anim);

  let text = `🔒 <b>${escapeHtml(anim.title)}</b>\n`;
  text += `<code>${anim.command}</code>\n\n`;
  text += `${escapeHtml(anim.description)}\n\n`;
  text += `<b>Как разблокировать:</b>\n`;

  const keyboard = new InlineKeyboard();
  keyboard.text('🎬 Демо', `anim_demo:${anim.command}`).row();

  if (anim.unlock_type === 'premium') {
    text += `💎 Подписка Pro\n`;
    keyboard.text('💎 Купить Pro', 'anim_buy_pro').row();
  } else if (anim.unlock_type === 'referrals') {
    const current = access.progress?.current ?? 0;
    text += `👥 Пригласи <b>${anim.unlock_threshold}</b> друзей\n`;
    text += `Прогресс: <b>${current}/${anim.unlock_threshold}</b>\n`;
    keyboard.text('👥 Моя реф. ссылка', 'anim_referral').row();
  }

  keyboard.text(`⬅️ К ${CATEGORIES[anim.category].title}`, `anim_cat:${anim.category}`);

  await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: keyboard });
});

animationsMenu.callbackQuery('anim_buy_pro', async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.reply('Используй /subscribe для покупки подписки Pro');
});

animationsMenu.callbackQuery('anim_referral', async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.reply('Используй /referral для получения реферальной ссылки');
});

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
