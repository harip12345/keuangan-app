const CHAT_MODELS = [
  'google/gemma-4-31b-it:free',
  'meta-llama/llama-4-maverick:free',
  'meta-llama/llama-4-scout:free',
  'openrouter/free',
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

    const openrouterKey = process.env.OPENROUTER_API_KEY;
    const groqKey = process.env.GROQ_API_KEY; // Mengambil key Groq dari Vercel

    const systemPrompt = `Kamu adalah Konsultan Keuangan Pribadi (Personal Wealth Consultant) yang analitis, objektif, dan berorientasi pada kesehatan arus kas serta pertumbuhan aset. 
Kamu memiliki akses eksklusif ke data keuangan real-time klien berikut:

${konteks}

Tugas dan Standar Operasional Kamu:
- Audit & Analisis Mendalam: Jangan sekadar mengulang angka. Identifikasi pola pengeluaran, deteksi anomali/kebocoran anggaran, dan nilai kesehatan rasio keuangan klien secara keseluruhan.
- Rekomendasi Strategis: Berikan saran yang konkret, taktis, dan dapat langsung dieksekusi (actionable). Fokus pada perbaikan kebiasaan finansial dan efisiensi anggaran jangka panjang.
- Proyeksi Berbasis Data: Manfaatkan tren 3 bulan terakhir untuk memprediksi risiko keuangan di masa depan. Jika ada potensi defisit, berikan langkah preventif secara proaktif.
- Gaya Bahasa & Persona: Gunakan bahasa Indonesia yang profesional, lugas, tajam, namun tetap memotivasi. Posisikan dirimu sebagai penasihat ahli yang setara, bukan sekadar bot pesuruh.
- Pemformatan Terstruktur: Gunakan **bold** untuk menyorot metrik krusial (angka, persentase, nama kategori) dan gunakan baris baru untuk memisahkan setiap ide agar laporan mudah dipindai secara visual.
- Batasan Respons: Sampaikan insight secara padat, bernilai tinggi (high-value), dan langsung pada inti masalah. Maksimal 200 kata, kecuali klien meminta audit yang lebih rinci.
- Identitas: Kamu adalah "Konsultan Keuangan AI" internal dari aplikasi ini. Kamu dilarang keras menyebutkan asal-usul teknologi pihak ketiga (seperti OpenAI, Google, Anthropic, dll) dalam kondisi apa pun.`;

    const messages = [
      { role: 'system', content: systemPrompt },
      ...history
    ];

    let lastError = '';

    // 1. COBA MENGGUNAKAN OPENROUTER DULU
    if (openrouterKey) {
      for (const model of CHAT_MODELS) {
        try {
          const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${openrouterKey}`,
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
            lastError = `OpenRouter (${model}): ${d?.error?.message || response.status}`;
            continue;
          }

          if (!response.ok) {
            const d = await response.json();
            lastError = `OpenRouter HTTP ${response.status}: ${d?.error?.message}`;
            continue;
          }

          const data = await response.json();
          const reply = data?.choices?.[0]?.message?.content || '';
          if (!reply) { lastError = `OpenRouter (${model}): respons kosong`; continue; }

          return res.status(200).json({ reply, model_used: model, provider: 'OpenRouter' });

        } catch (err) {
          lastError = `OpenRouter (${model}): ${err.message}`;
          continue;
        }
      }
    } else {
      lastError = 'OPENROUTER_API_KEY tidak dikonfigurasi. ';
    }

    // 2. JIKA OPENROUTER GAGAL/KOSONG, COBA JALUR CADANGAN KE GROQ
    if (groqKey) {
      try {
        const groqModel = 'llama3-8b-8192'; // Anda bisa ganti ke model Groq lain jika mau
        const response = await fetch('https://groq.com', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${groqKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: groqModel,
            messages,
            temperature: 0.7,
            max_tokens: 500
          })
        });

        if (response.ok) {
          const data = await response.json();
          const reply = data?.choices?.[0]?.message?.content || '';
          if (reply) {
            return res.status(200).json({ reply, model_used: groqModel, provider: 'Groq (Backup)' });
          }
        } else {
          const d = await response.json();
          lastError += ` | Groq Error: ${d?.error?.message || response.status}`;
        }
      } catch (err) {
        lastError += ` | Groq Exception: ${err.message}`;
      }
    } else {
      lastError += ' | GROQ_API_KEY tidak dikonfigurasi.';
    }

    // JIKA KEDUANYA GAGAL
    return res.status(503).json({ error: `Semua layanan AI sedang tidak tersedia. (${lastError})` });

  } catch (err) {
    console.error('ai-chat error:', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
}
