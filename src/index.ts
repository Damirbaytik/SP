import { Bot, webhookCallback } from 'grammy';
import express from 'express';
import { config } from './config.js';
import type { BotContext } from './types.js';

// Modules
import { businessModule } from './modules/business/index.js';
import { spyModule } from './modules/spy/index.js';
import { mediaModule } from './modules/media/index.js';
import { animationsModule } from './modules/animations/index.js';
import { animationsMenu } from './modules/animations/menu.js';
import { streaksModule } from './modules/streaks/index.js';
import { paymentsModule } from './modules/payments/index.js';
import { plusModule } from './modules/plus/index.js';
import { commandsModule } from './modules/commands/index.js';

const bot = new Bot<BotContext>(config.botToken);

// Error handling
bot.catch((err) => {
  console.error('[Bot] Error:', err.message);
});

// Register modules
bot.use(commandsModule);
bot.use(businessModule);
bot.use(plusModule);
bot.use(paymentsModule);
bot.use(animationsMenu);
bot.use(mediaModule);
bot.use(animationsModule);
bot.use(streaksModule);
bot.use(spyModule);

// Start
if (config.mode === 'webhook') {
  const app = express();
  app.use(express.json());

  app.use(`/webhook/${config.webhook.secret}`, webhookCallback(bot, 'express'));

  app.get('/health', (_req, res) => res.send('ok'));

  app.listen(config.webhook.port, async () => {
    const webhookUrl = `${config.webhook.url}/webhook/${config.webhook.secret}`;
    await bot.api.setWebhook(webhookUrl, {
      allowed_updates: ['message', 'callback_query', 'business_message', 'edited_business_message', 'deleted_business_messages', 'business_connection', 'pre_checkout_query'],
    });
    console.log(`[Bot] Webhook mode on port ${config.webhook.port}`);
    console.log(`[Bot] Webhook URL: ${webhookUrl}`);
  });
} else {
  bot.start({
    allowed_updates: ['message', 'callback_query', 'business_message', 'edited_business_message', 'deleted_business_messages', 'business_connection', 'pre_checkout_query'],
    onStart: (info) => {
      console.log(`[Bot] @${info.username} started (polling)`);
    },
  });
}
