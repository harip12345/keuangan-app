// Buat kode pairing / cek status / putuskan koneksi bot Telegram.
// - action "link"   : butuh idToken Firebase + profileId → kembalikan kode 6 digit (expire 10 menit) + username bot
// - action "status" : cek apakah profileId sudah terikat ke chat bot
// - action "unbind" : butuh idToken → lepas ikatan profileId dari bot
import { getAuth } from 'firebase-admin/auth';
import { getDb } from './_lib/firebaseAdmin.js';
import { createPending, getBindingByProfile, removeBindingByProfile } from './_lib/bindings.js';

async function tgGetMe() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const resp = await fetch(`https://api.telegram.org/bot${token}/getMe`, { method: 'POST' });
  const data = await resp.json();
  if (!data.ok) throw new Error(data.description || 'getMe gagal');
  return data.result;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    if (!process.env.TELEGRAM_BOT_TOKEN) {
      return res.status(500).json({ error: 'TELEGRAM_BOT_TOKEN belum di-set di Vercel' });
    }

    const { action = 'status', profileId } = req.body;
    if (!profileId) return res.status(400).json({ error: 'profileId wajib diisi' });

    if (action === 'status') {
      const binding = await getBindingByProfile(profileId);
      return res.status(200).json({ bound: !!binding, name: binding ? binding.name : '', chatId: binding ? binding.chatId : null });
    }

    const { idToken } = req.body;
    if (!idToken) return res.status(401).json({ error: 'idToken wajib diisi (login Firebase)' });

    const decoded = await getAuth().verifyIdToken(idToken);
    const uid = decoded.uid;

    if (action === 'unbind') {
      const removed = await removeBindingByProfile(profileId);
      return res.status(200).json({ ok: true, removed });
    }

    if (action === 'link') {
      const existing = await getBindingByProfile(profileId);
      if (existing) {
        return res.status(200).json({ alreadyBound: true, name: existing.name });
      }
      const name = (req.body.name || decoded.name || 'User').slice(0, 40);
      const pending = await createPending(profileId, name);
      let botUsername = null;
      try {
        const me = await tgGetMe();
        botUsername = me.username || null;
      } catch (e) {
        console.warn('getMe gagal:', e.message);
      }
      return res.status(200).json({
        ok: true,
        code: pending.code,
        expiresAt: pending.expiresAt,
        username: botUsername,
        uid
      });
    }

    return res.status(400).json({ error: 'action tidak dikenal' });
  } catch (err) {
    if (err.code === 'auth/argument-error') return res.status(401).json({ error: 'idToken tidak valid' });
    console.error('gen-link error:', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
}