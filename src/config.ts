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
} as const;
