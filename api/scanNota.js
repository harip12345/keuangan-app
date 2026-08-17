// Pemroses Vision (OCR Nota) — dipakai bersama oleh /api/scan-nota dan webhook Telegram.
// Model: Groq qwen vision utama, fallback Gemini 2.5 / 2.0.

const VISION_MODELS = [
  { provider: 'groq', id: 'qwen/qwen3.6-27b' },
  { provider: 'gemini', id: 'gemini-2.5-flash' },
  { provider: 'gemini', id: 'gemini-2.0-flash' }
];

async function callGroqVision(apiKey, model, imageBase64, mimeType, prompt) {
  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
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
      max_completion_tokens: 400,
      response_format: { type: 'json_object' },
      reasoning_effort: 'none',
      reasoning_format: 'hidden'
    })
  });
  return { status: response.status, data: await response.json() };
}

async function callGeminiVision(apiKey, model, imageBase64, mimeType, prompt) {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [
          { text: prompt },
          { inlineData: { mimeType: mimeType, data: imageBase64 } }
        ]
      }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 400,
        responseMimeType: 'application/json'
      }
    })
  });
  return { status: response.status, data: await response.json() };
}

export function buildNotaPrompt(todayISO) {
  const today = todayISO || new Date().toISOString().split('T')[0];
  return `Kamu adalah asisten pencatatan keuangan pribadi. Baca gambar nota/struk/receipt/kwitansi ini dengan teliti.

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
}

const validTypes = ['expense', 'income'];
const validWallets = ['Tunai', 'Muamalat', 'BSI', 'Bank Jago', 'SeaBank', 'Blu', 'e-Wallet'];
const validExpCats = ['Bensin', 'Body care', 'Dating', 'Ganti Oli', 'Infak', 'Jajan', 'Jalan-jalan', 'Makan dan Minum', 'Make up', 'Ngasih Ortu', 'Ngopi', 'Ojek', 'Parkir', 'Kuota/Wifi', 'Sabun Muka', 'Shopping', 'Skincare', 'Staycation', 'Sunscreen', 'Tabungan', 'Lainnya'];
const validIncCats = ['Gaji / Upah', 'Hasil Usaha / Bisnis', 'Bonus / THR', 'Pemberian / Uang Saku', 'Pencairan Investasi', 'Lainnya'];

// Mengembalikan { hasil, model_used, provider } atau melempar Error bila semua model gagal.
export async function extractNota(groqKey, geminiKey, imageBase64, mimeType) {
  const prompt = buildNotaPrompt();
  let lastError = '';

  for (const item of VISION_MODELS) {
    try {
      let status, data;
      if (item.provider === 'groq') {
        if (!groqKey) continue;
        const res = await callGroqVision(groqKey, item.id, imageBase64, mimeType, prompt);
        status = res.status; data = res.data;
      } else if (item.provider === 'gemini') {
        if (!geminiKey) continue;
        const res = await callGeminiVision(geminiKey, item.id, imageBase64, mimeType, prompt);
        status = res.status; data = res.data;
      }

      if (status !== 200) {
        lastError = `${item.id} (${item.provider}): ${data?.error?.message || 'HTTP ' + status}`;
        continue;
      }

      let rawText = '';
      if (item.provider === 'groq') rawText = data?.choices?.[0]?.message?.content || '';
      else if (item.provider === 'gemini') rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      if (!rawText) { lastError = `${item.id}: Respons teks kosong`; continue; }

      const cleaned = rawText.replace(/```json|```/g, '').trim();
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      if (!jsonMatch) { lastError = `${item.id}: Pola regex JSON tidak ditemukan`; continue; }

      const hasil = JSON.parse(jsonMatch[0]);
      if (!hasil.nominal && !hasil.keterangan) { lastError = `${item.id}: Atribut esensial gagal diekstrak`; continue; }

      if (!validTypes.includes(hasil.type)) hasil.type = 'expense';
      if (!validWallets.includes(hasil.wallet)) hasil.wallet = 'Tunai';
      const validCats = hasil.type === 'income' ? validIncCats : validExpCats;
      if (!validCats.includes(hasil.kategori)) hasil.kategori = 'Lainnya';

      return { hasil, model_used: item.id, provider: item.provider };
    } catch (err) {
      lastError = `${item.id} (${item.provider}): ${err.message}`;
    }
  }

  throw new Error(`Seluruh model pemroses Vision tidak tersedia. Log terakhir: ${lastError}`);
}