// Endpoint scan-nota — delegasi ke _lib/scanNota.js (logika Vision dibagi dengan webhook Telegram).
import { extractNota } from './_lib/scanNota.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { imageBase64, mimeType } = req.body;
    if (!imageBase64) return res.status(400).json({ error: 'imageBase64 tidak ada di request' });

    const groqKey = process.env.GROQ_API_KEY;
    const geminiKey = process.env.GEMINI_API_KEY;

    if (!groqKey && !geminiKey) {
      return res.status(500).json({ error: 'API Key (GROQ atau GEMINI) belum di-set di Vercel' });
    }

    try {
      const result = await extractNota(groqKey, geminiKey, imageBase64, mimeType);
      return res.status(200).json(result);
    } catch (err) {
      return res.status(503).json({ error: err.message });
    }
  } catch (err) {
    console.error('Fatal Handler error:', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
}