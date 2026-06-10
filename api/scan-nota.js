// Model vision free OpenRouter Juni 2026
const VISION_MODELS = [
  'google/gemma-4-31b-it:free',
  'openai/gpt-oss-120b:free',
  'nvidia/nemotron-3-nano-omni:free',
  'openrouter/auto',
];

async function callOpenRouter(apiKey, model, imageBase64, mimeType) {
  const today = new Date().toISOString().split('T')[0];
  const prompt = `Kamu adalah asisten pencatatan keuangan pribadi. Baca gambar nota/struk/receipt/kwitansi ini dengan teliti.

Tentukan informasi berikut lalu balas HANYA dengan JSON murni (tanpa markdown, tanpa backtick, tanpa penjelasan):
{
  "type": "expense",
  "tanggal": "YYYY-MM-DD",
  "nominal": 75000,
  "keterangan": "deskripsi singkat transaksi",
  "kategori": "Jajan",
  "kategori_custom": "",
  "wallet": "Tunai"
}

=== ATURAN TYPE ===
- "expense": pembayaran/pembelian/pengeluaran
- "income": bukti penerimaan uang/gaji/hasil jual

=== ATURAN KATEGORI ===
Jika expense, pilih SATU: Bensin, Body care, Dating, Ganti Oli, Infak, Jajan, Jalan-jalan, Makan dan Minum, Make up, Ngasih Ortu, Ngopi, Ojek, Parkir, Kuota/Wifi, Sabun Muka, Shopping, Skincare, Staycation, Sunscreen, Tabungan, Lainnya
Jika income, pilih SATU: Gaji / Upah, Hasil Usaha / Bisnis, Bonus / THR, Pemberian / Uang Saku, Pencairan Investasi, Lainnya

Panduan: Klinik/dokter/apotek → Lainnya | Makan/cafe → Makan dan Minum | Grab/Gojek → Ojek | Belanja online/mall → Shopping | Listrik/internet → Kuota/Wifi

=== ATURAN WALLET ===
Pilih SATU: Tunai, Muamalat, BSI, Bank Jago, SeaBank, Blu, e-Wallet
CASH/Tunai → Tunai | QRIS/GoPay/OVO/Dana → e-Wallet | Tidak ada petunjuk → Tunai

=== ATURAN LAIN ===
- tanggal: YYYY-MM-DD, jika tidak ada gunakan: ${today}
- nominal: total akhir dibayar, angka bulat tanpa simbol
- keterangan: nama toko + jenis transaksi, maks 60 karakter
- kategori_custom: isi HANYA jika kategori="Lainnya", tulis jenis pengeluaran 2-4 kata (contoh: "Perawatan Gigi"). Selain itu isi "".
- Balas HANYA JSON, tidak ada teks lain`;

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
      max_tokens: 400
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
    if (!apiKey) return res.status(500).json({ error: 'OPENROUTER_API_KEY belum di-set di Vercel' });

    let lastError = '';

    for (const model of VISION_MODELS) {
      console.log(`Mencoba model: ${model}`);
      try {
        const { status, data } = await callOpenRouter(apiKey, model, imageBase64, mimeType);

        // 402 = model tidak gratis lagi, skip
        if (status === 429 || status === 404 || status === 503 || status === 402) {
          const reason = data?.error?.message || `HTTP ${status}`;
          console.warn(`Model ${model} gagal (${reason}), coba berikutnya...`);
          lastError = `${model}: ${reason}`; continue;
        }
        if (status !== 200) {
          const reason = data?.error?.message || `HTTP ${status}`;
          return res.status(500).json({ error: `API error: ${reason}` });
        }

        const rawText = data?.choices?.[0]?.message?.content || '';
        if (!rawText) { lastError = `${model}: respons kosong`; continue; }

        const cleaned = rawText.replace(/```json|```/g, '').trim();
        const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
        if (!jsonMatch) { lastError = `${model}: format tidak valid`; continue; }

        const hasil = JSON.parse(jsonMatch[0]);
        if (!hasil.nominal && !hasil.keterangan) { lastError = `${model}: data tidak terbaca`; continue; }

        const validTypes   = ['expense', 'income'];
        const validWallets = ['Tunai', 'Muamalat', 'BSI', 'Bank Jago', 'SeaBank', 'Blu', 'e-Wallet'];
        const validExpCats = ['Bensin','Body care','Dating','Ganti Oli','Infak','Jajan','Jalan-jalan','Makan dan Minum','Make up','Ngasih Ortu','Ngopi','Ojek','Parkir','Kuota/Wifi','Sabun Muka','Shopping','Skincare','Staycation','Sunscreen','Tabungan','Lainnya'];
        const validIncCats = ['Gaji / Upah','Hasil Usaha / Bisnis','Bonus / THR','Pemberian / Uang Saku','Pencairan Investasi','Lainnya'];

        if (!validTypes.includes(hasil.type))     hasil.type   = 'expense';
        if (!validWallets.includes(hasil.wallet)) hasil.wallet = 'Tunai';
        const validCats = hasil.type === 'income' ? validIncCats : validExpCats;
        if (!validCats.includes(hasil.kategori))  hasil.kategori = 'Lainnya';

        console.log(`Berhasil dengan model: ${model}`);
        return res.status(200).json({ hasil, model_used: model });

      } catch (err) {
        lastError = `${model}: ${err.message}`;
        console.error(`Error pada model ${model}:`, err.message); continue;
      }
    }

    return res.status(503).json({
      error: `Semua model tidak tersedia. Detail: ${lastError}`
    });

  } catch (err) {
    console.error('Handler error:', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
}
