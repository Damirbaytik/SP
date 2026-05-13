import { Bot } from 'grammy';
import { config } from './config.js';
import type { BotContext } from './types.js';

// Modules
import { businessModule } from './modules/business/index.js';
import { spyModule } from './modules/spy/index.js';
import { mediaModule } from './modules/media/index.js';
import { animationsModule } from './modules/animations/index.js';
import { streaksModule } from './modules/streaks/index.js';
import { paymentsModule } from './modules/payments/index.js';
import { commandsModule } from './modules/commands/index.js';

const bot = new Bot<BotContext>(config.botToken);

// Error handling
bot.catch((err) => {
  console.error('[Bot] Error:', err.message);
});

// Register modules
bot.use(commandsModule);
bot.use(businessModule);
bot.use(paymentsModule);
bot.use(mediaModule);
bot.use(animationsModule);
bot.use(streaksModule);
bot.use(spyModule);

// Start
bot.start({
  onStart: (info) => {
    console.log(`[Bot] @${info.username} started`);
  },
});
