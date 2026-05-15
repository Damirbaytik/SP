import express from 'express';
import { Bot } from 'grammy';
import { config } from '../config.js';

const MEDIA_PORT = parseInt(process.env.MEDIA_PORT || '3001');
const MEDIA_SECRET = process.env.MEDIA_SECRET || config.webhook.secret;

export function startMediaServer(bot: Bot) {
  const app = express();

  // CORS для клиента
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Authorization');
    next();
  });

  // GET /media/:file_id — проксирует файл из Telegram
  app.get('/media/:fileId', async (req, res) => {
    try {
      const file = await bot.api.getFile(req.params.fileId);
      if (!file.file_path) {
        res.status(404).json({ error: 'File not found' });
        return;
      }
      const url = `https://api.telegram.org/file/bot${config.botToken}/${file.file_path}`;
      const response = await fetch(url);
      if (!response.ok) {
        res.status(response.status).json({ error: 'Telegram error' });
        return;
      }
      const contentType = response.headers.get('content-type') || 'application/octet-stream';
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', 'inline');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      const buffer = Buffer.from(await response.arrayBuffer());
      res.send(buffer);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.listen(MEDIA_PORT, () => {
    console.log(`[Media] Server on port ${MEDIA_PORT}`);
  });
}
