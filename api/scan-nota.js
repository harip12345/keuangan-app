// 1. Model vision GRATIS asli di OpenRouter (Urutan terbaik & stabil)
const VISION_MODELS = [
  'google/gemini-2.5-flash:free', // Model vision gratis terbaik saat ini
  'meta-llama/llama-3.2-11b-vision-instruct:free', // Cadangan vision gratis
];

// Fungsi untuk hit API OpenRouter
async function callOpenRouter(apiKey, model, imageBase64, mimeType, prompt) {
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

// 2. FUNGSI BARU: Hit API Groq Vision secara langsung
async function callGroq(apiKey, imageBase64, mimeType, prompt) {
  const response = await fetch('https://groq.com', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'llama-3.2-11b-vision-preview', // Model Vision Gratis & Super Cepat di Groq
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
    if (!mimeType) return res.status(400).json({ error: 'mimeType tidak ada di request' });

    const openrouterKey = process.env.OPENROUTER_API_KEY;
    const groqKey = process.env.GROQ_API_KEY; // Ambil Key Groq Privat Anda

    let lastError = '';
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

    // ----------------------------------------------------
    // JALUR 1: MENCOBA OPENROUTER TERLEBIH DAHULU
    // ----------------------------------------------------
    if (openrouterKey) {
      for (const model of VISION_MODELS) {
        console.log(`Mencoba model OpenRouter: ${model}`);
        try {
          const { status, data } = await callOpenRouter(openrouterKey, model, imageBase64, mimeType, prompt);

          if (status === 429 || status === 404 || status === 503) {
            lastError = `OpenRouter (${model}): ${data?.error?.message || status}`;
            continue;
          }

          if (status !== 200) {
            lastError = `OpenRouter (${model}) HTTP ${status}: ${data?.error?.message}`;
            continue;
          }

          const rawText = data?.choices?.[0]?.message?.content || '';
          if (!rawText) { lastError = `OpenRouter (${model}): respons kosong`; continue; }

          // Proses & Normalisasi JSON (Gunakan fungsi pembersih Anda)
          const hasil = parsingDanValidasiJSON(rawText);
          if (hasil) {
            console.log(`Berhasil dengan OpenRouter: ${model}`, hasil);
            return res.status(200).json({ hasil, model_used: model, provider: 'OpenRouter' });
          } else {
            lastError = `OpenRouter (${model}): Gagal validasi struktur JSON`;
          }

        } catch (err) {
          lastError = `OpenRouter (${model}) Exception: ${err.message}`;
          continue;
        }
      }
    } else {
      lastError = 'OPENROUTER_API_KEY tidak di-set. ';
    }

    // ----------------------------------------------------
    // JALUR 2: CADANGAN UTAMA MENGGUNAKAN GROQ VISION
    // ----------------------------------------------------
    if (groqKey) {
      console.log('Semua OpenRouter gagal/tidak ada key. Beralih ke Groq...');
      try {
        const { status, data } = await callGroq(groqKey, imageBase64, mimeType, prompt);

        if (status === 200) {
          const rawText = data?.choices?.[0]?.message?.content || '';
          const hasil = parsingDanValidasiJSON(rawText);
          if (hasil) {
            console.log('Berhasil dengan Groq (Backup Vision)', hasil);
            return res.status(200).json({ hasil, model_used: 'llama-3.2-11b-vision-preview', provider: 'Groq' });
          } else {
            lastError += ' | Groq: Gagal validasi struktur JSON';
          }
        } else {
          lastError += ` | Groq HTTP ${status}: ${data?.error?.message || 'Error'}`;
        }
      } catch (err) {
        lastError += ` | Groq Exception: ${err.message}`;
      }
    } else {
      lastError += ' | GROQ_API_KEY tidak di-set.';
    }

    // JIKA KEDUANYA GAGAL TOTAL
    return res.status(503).json({
      error: `Semua model AI Vision sedang tidak tersedia. Detail kesalahan terakhir: ${lastError}`
    });

  } catch (err) {
    console.error('Handler error:', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
}

// Fungsi bantu untuk memisahkan logika parsing agar kode di atas bersih & tidak berulang
function parsingDanValidasiJSON(rawText) {
  try {
    const cleaned = rawText.replace(/```json|```/g, '').trim();
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const hasil = JSON.parse(jsonMatch[0]);
    if (!hasil.nominal && !hasil.keterangan) return null;

    // Filter validasi bawaan Anda
    const validTypes    = ['expense', 'income'];
    const validWallets  = ['Tunai', 'Muamalat', 'BSI', 'Bank Jago', 'SeaBank', 'Blu', 'e-Wallet'];
    const validExpCats  = ['Bensin','Body care','Dating','Ganti Oli','Infak','Jajan','Jalan-jalan','Makan dan Minum','Make up','Ngasih Ortu','Ngopi','Ojek','Parkir','Kuota/Wifi','Sabun Muka','Shopping','Skincare','Staycation','Sunscreen','Tabungan','Lainnya'];
    const validIncCats  = ['Gaji / Upah','Hasil Usaha / Bisnis','Bonus / THR','Pemberian / Uang Saku','Pencairan Investasi','Lainnya'];

    if (!validTypes.includes(hasil.type))   hasil.type   = 'expense';
    if (!validWallets.includes(hasil.wallet)) hasil.wallet = 'Tunai';

    const validCats = hasil.type === 'income' ? validIncCats : validExpCats;
    if (!validCats.includes(hasil.kategori)) hasil.kategori = 'Lainnya';

    return hasil;
  } catch (e) {
    return null;
  }
}
