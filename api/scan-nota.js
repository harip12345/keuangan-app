// Model vision gratis di OpenRouter, diurutkan dari yang terbaik
// Kalau satu gagal/penuh, otomatis coba model berikutnya
const VISION_MODELS = [
  'google/gemma-4-31b-it:free',
  'meta-llama/llama-4-maverick:free',
  'meta-llama/llama-4-scout:free',
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
- "expense" : jika nota adalah pembayaran / pembelian / pengeluaran (belanja, makan, bensin, klinik, dll)
- "income"  : jika nota adalah bukti penerimaan uang / gaji / hasil jual / transfer masuk

=== ATURAN KATEGORI ===
Jika type = "expense", pilih SATU dari:
Bensin, Body care, Dating, Ganti Oli, Infak, Jajan, Jalan-jalan, Makan dan Minum, Make up, Ngasih Ortu, Ngopi, Ojek, Parkir, Kuota/Wifi, Sabun Muka, Shopping, Skincare, Staycation, Sunscreen, Tabungan, Lainnya

Jika type = "income", pilih SATU dari:
Gaji / Upah, Hasil Usaha / Bisnis, Bonus / THR, Pemberian / Uang Saku, Pencairan Investasi, Lainnya

Panduan memilih kategori:
- Klinik, dokter, apotek, obat, rumah sakit, perawatan gigi → Lainnya (expense)
- Makan, restoran, warteg, cafe, minuman → Makan dan Minum
- Grab, Gojek, ojek, parkir, bensin → sesuai jenisnya
- Skincare, sabun muka, sunscreen, body care → sesuai jenisnya
- Belanja online, toko, mall → Shopping
- Listrik, air, internet, pulsa → Kuota/Wifi atau Lainnya

=== ATURAN WALLET ===
Cari petunjuk metode pembayaran di nota. Pilih SATU dari:
Tunai, Muamalat, BSI, Bank Jago, SeaBank, Blu, e-Wallet

Panduan memilih wallet:
- "CASH", "Tunai", "Bayar Tunai" → Tunai
- "QRIS", "GoPay", "OVO", "Dana", "ShopeePay", "LinkAja" → e-Wallet
- "Muamalat", "Muammalat" → Muamalat
- "BSI", "Bank Syariah Indonesia" → BSI
- "Jago", "Bank Jago" → Bank Jago
- "SeaBank", "Sea Bank" → SeaBank
- "Blu", "BCA Digital" → Blu
- Jika tidak ada petunjuk sama sekali → Tunai

=== ATURAN LAIN ===
- tanggal: format YYYY-MM-DD. Jika tidak ada tanggal di nota, gunakan hari ini: ${today}
- nominal: total akhir yang dibayar (bukan subtotal sebelum diskon), angka bulat tanpa titik/koma/simbol
- keterangan: nama toko + jenis transaksi, maks 60 karakter
- kategori_custom: WAJIB diisi jika kategori = "Lainnya". Tulis nama jenis pengeluaran/pemasukan saja, singkat 2-4 kata, tanpa nama toko (contoh: "Perawatan Gigi", "Servis Motor", "Iuran Sekolah", "Obat-obatan", "Biaya Pengiriman"). Jika kategori bukan "Lainnya", isi string kosong "".
- Balas HANYA JSON, tidak ada teks lain sama sekali`;

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': Bearer ${apiKey},
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
          { type: 'image_url', image_url: { url: data:${mimeType};base64,${imageBase64} } }
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
    if (!apiKey) return res.status(500).json({ error: 'OPENROUTER_API_KEY belum di-set di Vercel Environment Variables' });

    let lastError = '';

    for (const model of VISION_MODELS) {
      console.log(Mencoba model: ${model});
      try {
        const { status, data } = await callOpenRouter(apiKey, model, imageBase64, mimeType);

        if (status === 429 || status === 404 || status === 503) {
          const reason = data?.error?.message || HTTP ${status};
          console.warn(Model ${model} gagal (${reason}), coba model berikutnya...);
          lastError = ${model}: ${reason};
          continue;
        }

        if (status !== 200) {
          const reason = data?.error?.message || HTTP ${status};
          return res.status(500).json({ error: API error: ${reason} });
        }

        const rawText = data?.choices?.[0]?.message?.content || '';
        if (!rawText) { lastError = ${model}: respons kosong; continue; }

        const cleaned = rawText.replace(/json|/g, '').trim();
        const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
        if (!jsonMatch) { lastError = ${model}: format tidak valid; continue; }

        const hasil = JSON.parse(jsonMatch[0]);
        if (!hasil.nominal && !hasil.keterangan) { lastError = ${model}: data tidak terbaca; continue; }

        // Validasi & normalisasi nilai-nilai yang dikembalikan
        const validTypes    = ['expense', 'income'];
        const validWallets  = ['Tunai', 'Muamalat', 'BSI', 'Bank Jago', 'SeaBank', 'Blu', 'e-Wallet'];
        const validExpCats  = ['Bensin','Body care','Dating','Ganti Oli','Infak','Jajan','Jalan-jalan','Makan dan Minum','Make up','Ngasih Ortu','Ngopi','Ojek','Parkir','Kuota/Wifi','Sabun Muka','Shopping','Skincare','Staycation','Sunscreen','Tabungan','Lainnya'];
        const validIncCats  = ['Gaji / Upah','Hasil Usaha / Bisnis','Bonus / THR','Pemberian / Uang Saku','Pencairan Investasi','Lainnya'];

        if (!validTypes.includes(hasil.type))   hasil.type   = 'expense';
        if (!validWallets.includes(hasil.wallet)) hasil.wallet = 'Tunai';

        const validCats = hasil.type === 'income' ? validIncCats : validExpCats;
        if (!validCats.includes(hasil.kategori)) hasil.kategori = 'Lainnya';

        console.log(Berhasil dengan model: ${model}, hasil);
        return res.status(200).json({ hasil, model_used: model });

      } catch (err) {
        lastError = ${model}: ${err.message};
        console.error(Error pada model ${model}:, err.message);
        continue;
      }
    }

    return res.status(503).json({
      error: Semua model AI sedang tidak tersedia. Coba lagi dalam beberapa menit. Detail: ${lastError}
    });

  } catch (err) {
    console.error('Handler error:', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
}
