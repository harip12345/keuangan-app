const CHAT_MODELS = [
  'google/gemma-4-31b-it:free',
  'meta-llama/llama-4-maverick:free',
  'meta-llama/llama-4-scout:free',
  'openrouter/auto',
];

const GROQ_MODELS = [
  'llama-3.3-70b-versatile',
  'llama3-70b-8192',
  'llama3-8b-8192',
  'gemma2-9b-it',
];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { history, konteks } = req.body;
    if (!history || !Array.isArray(history)) {
      return res.status(400).json({ error: 'history tidak valid' });
    }

    const openrouterKey = process.env.OPENROUTER_API_KEY;
    const groqKey       = process.env.GROQ_API_KEY;

    const today = new Date().toLocaleDateString('id-ID', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
    });

    const systemPrompt = `Kamu adalah Chief Financial Advisor & Investment Manager pribadi klien — seorang profesional keuangan senior dengan keahlian ganda: manajemen arus kas harian dan strategi pertumbuhan aset jangka panjang.

Kamu memiliki akses eksklusif ke data keuangan real-time klien berikut:
${konteks}

Hari ini: ${today}

Kerangka Kerja Profesional Kamu:

1. AUDIT KEUANGAN
Identifikasi kebocoran anggaran, anomali pengeluaran, dan rasio kesehatan keuangan (saving rate, rasio utang, dana darurat). Jangan sekadar mengulang angka — berikan interpretasi dan konteks.

2. STRATEGI INVESTASI & KONDISI EKONOMI
Kamu memiliki kemampuan mencari informasi terkini dari internet. Gunakan kemampuan ini untuk:
- Mengecek kondisi ekonomi makro terkini (inflasi BI, suku bunga, kurs IDR, IHSG, harga emas)
- Mencari berita ekonomi Indonesia dan global yang relevan dari sumber kredibel (Bank Indonesia, OJK, Bloomberg, Reuters, Kompas Ekonomi, CNBC Indonesia)
- Memberikan rekomendasi instrumen investasi yang kontekstual dengan kondisi pasar saat ini
- Menyebut sumber data yang kamu gunakan agar klien bisa memverifikasi

3. PERENCANAAN KEUANGAN
Bantu klien membangun roadmap finansial: dana darurat ideal (3–6 bulan pengeluaran), target investasi bulanan, dan proyeksi pertumbuhan kekayaan berdasarkan tren historis data mereka.

4. MANAJEMEN RISIKO
Deteksi potensi defisit, ketergantungan pada satu sumber pendapatan, atau overexposure pada kategori pengeluaran tertentu. Berikan langkah mitigasi yang konkret.

Standar Komunikasi:
- Gunakan bahasa Indonesia yang tajam, profesional, dan memotivasi.
- Gunakan **bold** untuk angka, persentase, nama instrumen, dan metrik krusial.
- Pisahkan setiap ide dengan baris baru. Jangan gunakan ### sebagai header.
- Jika menggunakan data dari web, sebutkan sumbernya secara singkat (contoh: "Menurut BI per ${today}...").
- Respons padat maksimal 250 kata kecuali klien meminta analisis mendalam.
- Jika data bulan tertentu kosong, sebutkan keterbatasan lalu tetap beri rekomendasi dari data yang ada.

Identitas: Kamu adalah "Financial Advisor AI" eksklusif dari aplikasi ini. Dilarang keras menyebut asal teknologi (OpenAI, Google, Anthropic, Groq, Meta, atau vendor apapun).`;

    const messages = [
      { role: 'system', content: systemPrompt },
      ...history
    ];

    let lastError = '';

    // ── 1. COBA OPENROUTER DULU (support web search plugin) ─────────────────
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
              max_tokens: 700,
              // Plugin web search OpenRouter — aktif otomatis saat model support
              plugins: [
                {
                  id: 'web',
                  max_results: 5,
                  search_prompt: 'Cari informasi ekonomi Indonesia terkini, kondisi pasar investasi, suku bunga BI, IHSG, dan berita keuangan relevan dari sumber kredibel.'
                }
              ]
            })
          });

          if (response.status === 429 || response.status === 404 || response.status === 503) {
            const d = await response.json().catch(() => ({}));
            lastError = `OpenRouter (${model}): ${d?.error?.message || response.status}`;
            continue;
          }

          if (!response.ok) {
            const d = await response.json().catch(() => ({}));
            lastError = `OpenRouter HTTP ${response.status}: ${d?.error?.message || ''}`;
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

    // ── 2. FALLBACK KE GROQ (tidak support web search, tapi tetap berguna) ──
    if (groqKey) {
      // Tambahkan konteks ekonomi statis sebagai fallback saat tidak ada web search
      const fallbackMessages = [
        {
          role: 'system',
          content: systemPrompt + '\n\n[CATATAN: Koneksi web search tidak tersedia saat ini. Gunakan pengetahuan ekonomi terbaru yang kamu miliki dan sampaikan bahwa data pasar perlu diverifikasi secara mandiri oleh klien.]'
        },
        ...history
      ];

      for (const model of GROQ_MODELS) {
        try {
          const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${groqKey}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              model,
              messages: fallbackMessages,
              temperature: 0.7,
              max_tokens: 700
            })
          });

          if (response.status === 429 || response.status === 503) {
            const d = await response.json().catch(() => ({}));
            lastError += ` | Groq (${model}): ${d?.error?.message || response.status}`;
            continue;
          }

          if (response.status === 404) {
            lastError += ` | Groq model ${model} tidak ditemukan`;
            continue;
          }

          if (!response.ok) {
            const d = await response.json().catch(() => ({}));
            lastError += ` | Groq HTTP ${response.status}: ${d?.error?.message || ''}`;
            continue;
          }

          const data = await response.json();
          const reply = data?.choices?.[0]?.message?.content || '';
          if (!reply) { lastError += ` | Groq (${model}): respons kosong`; continue; }

          return res.status(200).json({ reply, model_used: model, provider: 'Groq' });

        } catch (err) {
          lastError += ` | Groq (${model}): ${err.message}`;
          continue;
        }
      }
    } else {
      lastError += ' | GROQ_API_KEY tidak dikonfigurasi.';
    }

    return res.status(503).json({
      error: `Semua layanan AI sedang tidak tersedia. Coba lagi dalam beberapa menit. (${lastError})`
    });

  } catch (err) {
    console.error('ai-chat error:', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
}
