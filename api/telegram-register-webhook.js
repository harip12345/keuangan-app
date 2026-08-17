// Daftarkan / info / hapus webhook Telegram ke endpoint Vercel.
// Panggil sekali setelah deploy (dan tiap ganti domain).
//   POST /api/telegram-register-webhook
//   Header: x-service-key: <TELEGRAM_SERVICE_KEY>
//   Body:   { "action": "set" | "info" | "unset" }
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const serviceKey = process.env.TELEGRAM_SERVICE_KEY;
  if (!serviceKey) return res.status(500).json({ error: 'TELEGRAM_SERVICE_KEY belum di-set di Vercel' });
  if (req.headers['x-service-key'] !== serviceKey) return res.status(403).json({ error: 'x-service-key salah' });

  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return res.status(500).json({ error: 'TELEGRAM_BOT_TOKEN belum di-set di Vercel' });

  const { action = 'set' } = req.body || {};

  try {
    if (action === 'info') {
      const resp = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`);
      const data = await resp.json();
      return res.status(200).json(data);
    }

    if (action === 'unset') {
      const resp = await fetch(`https://api.telegram.org/bot${token}/deleteWebhook`);
      const data = await resp.json();
      return res.status(200).json(data);
    }

    const host = req.body.url ? null : req.headers.host;
    if (!host && !req.body.url) return res.status(400).json({ error: 'Tidak bisa menentukan host' });
    const url = req.body.url || `https://${host}/api/telegram-webhook`;
    const secret = process.env.TELEGRAM_WEBHOOK_SECRET || '';

    const resp = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url,
        secret_token: secret || undefined,
        allowed_updates: ['message']
      })
    });
    const data = await resp.json();
    return res.status(200).json({ ...data, url });
  } catch (err) {
    console.error('register-webhook error:', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
}