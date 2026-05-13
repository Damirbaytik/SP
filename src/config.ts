import 'dotenv/config';

export const config = {
  botToken: process.env.BOT_TOKEN!,
  supabase: {
    url: process.env.SUPABASE_URL!,
    serviceKey: process.env.SUPABASE_SERVICE_KEY!,
  },
  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
  },
  cache: {
    messageTtl: 60 * 60 * 24, // 24 часа
  },
  webhook: {
    url: process.env.WEBHOOK_URL || '', // https://your-domain.com или ngrok URL
    port: parseInt(process.env.PORT || '3000'),
    secret: process.env.WEBHOOK_SECRET || 'spy-dialog-bot-secret',
  },
  mode: (process.env.MODE || 'polling') as 'polling' | 'webhook',
} as const;
