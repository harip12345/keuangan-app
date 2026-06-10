const GROQ_MODELS = [
  'llama-3.3-70b-versatile',
  'llama3-70b-8192',
  'llama3-8b-8192',
];

// Model free OpenRouter Juni 2026 yang masih aktif
const OPENROUTER_MODELS = [
  'google/gemma-4-31b-it:free',
  'openai/gpt-oss-120b:free',
  'nvidia/nemotron-3-super-120b-a12b:free',
  'google/gemma-4-26b-a4b-it:free',
  'openrouter/auto',
];

const WEB_SEARCH_TRIGGERS = [
  'harga', 'kurs', 'ihsg', 'saham', 'emas', 'inflasi', 'suku bunga', 'bi rate',
  'dolar', 'usd', 'rupiah', 'ekonomi', 'pasar', 'bursa', 'investasi terkini',
  'berita', 'hari ini', 'sekarang', 'terbaru', 'terkini', 'update', 'kondisi',
  'reksa dana', 'obligasi', 'sbr', 'sukuk', 'deposito rate', 'bunga bank',
  'kripto', 'bitcoin', 'crypto', 'forex', 'global', 'fed', 'the fed',
  'resesi', 'gdp', 'pdb', 'ojk', 'bank indonesia', 'bloomberg', 'reuters'
];

function needsWebSearch(history) {
  const lastUser = [...history].reverse().find(m => m.role === 'user');
  if (!lastUser) return false;
  const text = lastUser.content.toLowerCase();
  return WEB_SEARCH_TRIGGERS.some(kw => text.includes(kw));
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { history, konteks } = req.body;
    if (!history || !Array.isArray(history)) return res.status(400).json({ error: 'history tidak valid' });

    const groqKey       = process.env.GROQ_API_KEY;
    const openrouterKey = process.env.OPENROUTER_API_KEY;
    const today = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
    const useWebSearch = needsWebSearch(history);

    const systemPrompt = `Kamu adalah Chief Financial Advisor & Investment Manager pribadi klien — profesional keuangan senior dengan keahlian manajemen arus kas dan strategi pertumbuhan aset.

Data keuangan real-time klien:
${konteks}

Hari ini: ${today}

Tugas:
- AUDIT: Identifikasi kebocoran anggaran, anomali pengeluaran, rasio saving rate, dana darurat.
- INVESTASI: Rekomendasikan instrumen investasi (reksa dana, deposito, saham, emas) sesuai kondisi keuangan klien.
- PERENCANAAN: Roadmap finansial — dana darurat ideal, target investasi bulanan, proyeksi pertumbuhan.
- RISIKO: Deteksi potensi defisit atau ketergantungan satu sumber pendapatan. Beri langkah mitigasi konkret.
${useWebSearch ? `- WEB SEARCH AKTIF: Gunakan data terkini dari internet. Sebutkan sumber singkat (contoh: "Menurut BI per ${today}...").` : ''}

Format:
- Bahasa Indonesia profesional, tajam, memotivasi.
- **Bold** untuk angka, persentase, nama instrumen krusial.
- Baris baru antar ide. Tanpa ### header.
- Maks 220 kata kecuali diminta analisis mendalam.
- Jika data bulan tertentu kosong, sebutkan lalu tetap beri rekomendasi.
- Identitas: "Financial Advisor AI" dari aplikasi ini. Jangan sebut vendor teknologi apapun.`;

    const messages = [{ role: 'system', content: systemPrompt }, ...history];
    let lastError = '';

    // ── JALUR A: GROQ (default, cepat, tanpa web search) ────────────────────
    if (!useWebSearch && groqKey) {
      for (const model of GROQ_MODELS) {
        try {
          const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${groqKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model, messages, temperature: 0.7, max_tokens: 600 })
          });
          if (resp.status === 429 || resp.status === 503) {
            const d = await resp.json().catch(() => ({}));
            lastError = `Groq (${model}): ${d?.error?.message || resp.status}`; continue;
          }
          if (resp.status === 404) { lastError = `Groq: model ${model} tidak ada`; continue; }
          if (!resp.ok) {
            const d = await resp.json().catch(() => ({}));
            return res.status(500).json({ error: `Groq error: ${d?.error?.message || resp.status}` });
          }
          const data = await resp.json();
          const reply = data?.choices?.[0]?.message?.content || '';
          if (!reply) { lastError = `Groq (${model}): respons kosong`; continue; }
          return res.status(200).json({ reply, model_used: model, provider: 'Groq' });
        } catch (err) { lastError = `Groq (${model}): ${err.message}`; continue; }
      }
      console.log('Groq gagal, fallback ke OpenRouter');
    }

    // ── JALUR B: OPENROUTER (web search aktif atau Groq gagal) ───────────────
    if (openrouterKey) {
      for (const model of OPENROUTER_MODELS) {
        try {
          const body = { model, messages, temperature: 0.7, max_tokens: 700 };
          if (useWebSearch) {
            body.plugins = [{
              id: 'web',
              max_results: 5,
              search_prompt: 'Cari data ekonomi Indonesia terkini: suku bunga BI, IHSG, kurs rupiah, harga emas, inflasi, kondisi pasar investasi dari sumber kredibel (BI, OJK, Bloomberg, Reuters, CNBC Indonesia).'
            }];
          }
          const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${openrouterKey}`,
              'Content-Type': 'application/json',
              'HTTP-Referer': 'https://vercel.app',
              'X-Title': 'Finance App AI Chat'
            },
            body: JSON.stringify(body)
          });
          if (resp.status === 429 || resp.status === 402 || resp.status === 404 || resp.status === 503) {
            const d = await resp.json().catch(() => ({}));
            lastError += ` | OpenRouter (${model}): ${d?.error?.message || resp.status}`; continue;
          }
          if (!resp.ok) {
            lastError += ` | OpenRouter HTTP ${resp.status}`; continue;
          }
          const data = await resp.json();
          const reply = data?.choices?.[0]?.message?.content || '';
          if (!reply) { lastError += ` | OpenRouter (${model}): kosong`; continue; }
          return res.status(200).json({
            reply, model_used: model,
            provider: useWebSearch ? 'OpenRouter+WebSearch' : 'OpenRouter'
          });
        } catch (err) { lastError += ` | OpenRouter (${model}): ${err.message}`; continue; }
      }
    } else {
      lastError += ' | OPENROUTER_API_KEY tidak dikonfigurasi.';
    }

    return res.status(503).json({ error: `Semua AI tidak tersedia. (${lastError})` });

  } catch (err) {
    console.error('ai-chat error:', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
}
