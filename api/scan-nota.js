// Model vision gratis di OpenRouter, diurutkan dari yang terbaik
// Kalau satu gagal/penuh, otomatis coba model berikutnya
const VISION_MODELS = [
  'google/gemma-4-31b-it:free',
  'meta-llama/llama-4-maverick:free',
  'meta-llama/llama-4-scout:free',
  'openrouter/auto',  // OpenRouter pilihkan model gratis yang tersedia
];

async function callOpenRouter(apiKey, model, imageBase64, mimeType) {
  const prompt = `Kamu adalah asisten pencatatan keuangan. Baca gambar nota/struk/receipt ini.
Balas HANYA dengan JSON murni (tanpa markdown, tanpa backtick, tanpa penjelasan apapun):
{
  "tanggal": "YYYY-MM-DD",
  "nominal": 75000,
  "keterangan": "deskripsi singkat transaksi",
  "kategori": "Makanan & Minuman"
}
Aturan:
- tanggal: format YYYY-MM-DD. Jika tidak ada, gunakan hari ini.
- nominal: total yang dibayar, angka bulat tanpa titik/koma/simbol.
- keterangan: nama toko atau jenis pembelian, maks 50 karakter.
- kategori: pilih SATU dari: Makanan & Minuman, Transport, Belanja, Kesehatan, Hiburan, Tagihan, Lainnya.
- Balas HANYA JSON, tidak ada teks lain.`;

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://vercel.app',
      'X-Title': 'Finance App Scan Nota'
    },
    body: JSON.stringify({
      model,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${imageBase64}` } }
        ]
      }],
      temperature: 0.1,
      max_tokens: 300
    })
  });

  return { status: response.status, data: await response.json() };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { imageBase64, mimeType } = req.body;
    if (!imageBase64) return res.status(400).json({ error: 'imageBase64 tidak ada di request' });

    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'OPENROUTER_API_KEY belum di-set di Vercel Environment Variables' });

    let lastError = '';

    // Coba satu per satu model, lanjut ke berikutnya kalau gagal
    for (const model of VISION_MODELS) {
      console.log(`Mencoba model: ${model}`);
      try {
        const { status, data } = await callOpenRouter(apiKey, model, imageBase64, mimeType);

        // Kalau rate limit atau model tidak tersedia, coba model berikutnya
        if (status === 429 || status === 404 || status === 503) {
          const reason = data?.error?.message || `HTTP ${status}`;
          console.warn(`Model ${model} gagal (${reason}), coba model berikutnya...`);
          lastError = `${model}: ${reason}`;
          continue;
        }

        // Error lain yang tidak perlu dicoba ulang
        if (status !== 200) {
          const reason = data?.error?.message || `HTTP ${status}`;
          return res.status(500).json({ error: `API error: ${reason}` });
        }

        // Sukses — ambil teks dari response
        const rawText = data?.choices?.[0]?.message?.content || '';
        if (!rawText) {
          lastError = `${model}: respons kosong`;
          continue;
        }

        // Bersihkan dan ekstrak JSON
        const cleaned = rawText.replace(/```json|```/g, '').trim();
        const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          lastError = `${model}: format tidak valid`;
          continue;
        }

        const hasil = JSON.parse(jsonMatch[0]);

        // Validasi field penting ada
        if (!hasil.nominal && !hasil.keterangan) {
          lastError = `${model}: data tidak terbaca`;
          continue;
        }

        console.log(`Berhasil dengan model: ${model}`);
        return res.status(200).json({ hasil, model_used: model });

      } catch (err) {
        lastError = `${model}: ${err.message}`;
        console.error(`Error pada model ${model}:`, err.message);
        continue;
      }
    }

    // Semua model gagal
    return res.status(503).json({
      error: `Semua model AI sedang tidak tersedia. Coba lagi dalam beberapa menit. Detail: ${lastError}`
    });

  } catch (err) {
    console.error('Handler error:', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
}
