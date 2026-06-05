export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { imageBase64, mimeType } = req.body;

    if (!imageBase64) {
      return res.status(400).json({ error: 'imageBase64 tidak ada di request body' });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'GEMINI_API_KEY belum di-set di environment variables Vercel' });
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

    const prompt = `Kamu adalah asisten pencatatan keuangan. Baca gambar nota/struk/receipt ini dengan teliti.
Ekstrak informasi dan balas HANYA dengan JSON murni (tanpa markdown, tanpa backtick, tanpa penjelasan):
{
  "tanggal": "YYYY-MM-DD",
  "nominal": 75000,
  "keterangan": "deskripsi singkat transaksi",
  "kategori": "Makanan & Minuman"
}

Aturan:
- tanggal: format YYYY-MM-DD. Jika tidak ada tanggal di nota, gunakan tanggal hari ini.
- nominal: total yang dibayar, angka bulat tanpa titik/koma/simbol mata uang.
- keterangan: nama toko atau jenis pembelian, maksimal 50 karakter.
- kategori: HARUS salah satu dari: Makanan & Minuman, Transport, Belanja, Kesehatan, Hiburan, Tagihan, Lainnya.
- Balas HANYA JSON, tidak ada teks lain sama sekali.`;

    const geminiResponse = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: prompt },
            { inline_data: { mime_type: mimeType || 'image/jpeg', data: imageBase64 } }
          ]
        }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 300,
          responseMimeType: "application/json"
        }
      })
    });

    const data = await geminiResponse.json();

    // Teruskan response Gemini apa adanya ke client
    return res.status(200).json(data);

  } catch (err) {
    console.error('scan-nota handler error:', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
}
