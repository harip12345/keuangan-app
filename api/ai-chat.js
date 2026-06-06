const CHAT_MODELS = [
  'google/gemma-4-31b-it:free',
  'meta-llama/llama-4-maverick:free',
  'meta-llama/llama-4-scout:free',
  'openrouter/auto',
];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { history, konteks } = req.body;
    if (!history || !Array.isArray(history)) return res.status(400).json({ error: 'history tidak valid' });

    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'OPENROUTER_API_KEY belum di-set di Vercel' });

    const systemPrompt = `Kamu adalah asisten keuangan pribadi yang ramah, cerdas, dan empatik. 
Kamu memiliki akses ke data keuangan real-time pengguna berikut:

${konteks}

Tugas kamu:
- Analisis data keuangan pengguna secara akurat berdasarkan data di atas
- Berikan saran keuangan yang personal, konkret, dan actionable
- Gunakan bahasa Indonesia yang santai tapi tetap profesional
- Format jawaban dengan rapi: gunakan **bold** untuk angka/poin penting, dan baris baru untuk readability
- Jika ditanya prediksi, gunakan data tren 3 bulan terakhir sebagai dasar
- Selalu berikan insight yang berguna, bukan hanya mengulang data
- Jawaban singkat dan padat, maksimal 200 kata kecuali diminta lebih detail
- Jangan sebut bahwa kamu AI dari OpenRouter/Google/Meta — kamu adalah Asisten Keuangan AI dari aplikasi ini`;

    const messages = [
      { role: 'system', content: systemPrompt },
      ...history
    ];

    let lastError = '';

    for (const model of CHAT_MODELS) {
      try {
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://vercel.app',
            'X-Title': 'Finance App AI Chat'
          },
          body: JSON.stringify({
            model,
            messages,
            temperature: 0.7,
            max_tokens: 500
          })
        });

        if (response.status === 429 || response.status === 404 || response.status === 503) {
          const d = await response.json();
          lastError = `${model}: ${d?.error?.message || response.status}`;
          continue;
        }

        if (!response.ok) {
          const d = await response.json();
          return res.status(500).json({ error: d?.error?.message || `HTTP ${response.status}` });
        }

        const data = await response.json();
        const reply = data?.choices?.[0]?.message?.content || '';
        if (!reply) { lastError = `${model}: respons kosong`; continue; }

        return res.status(200).json({ reply, model_used: model });

      } catch (err) {
        lastError = `${model}: ${err.message}`;
        continue;
      }
    }

    return res.status(503).json({ error: `Semua model AI sedang tidak tersedia. Coba lagi sebentar. (${lastError})` });

  } catch (err) {
    console.error('ai-chat error:', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
}
