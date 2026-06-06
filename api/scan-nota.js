export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { imageBase64, mimeType } = req.body;
    if (!imageBase64) return res.status(400).json({ error: 'imageBase64 tidak ada' });

    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'OPENROUTER_API_KEY belum di-set di Vercel' });

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
        // Model gratis terbaik untuk baca gambar di OpenRouter
        model: 'google/gemini-2.0-flash-exp:free',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: `data:${mimeType};base64,${imageBase64}` } }
            ]
          }
        ],
        temperature: 0.1,
        max_tokens: 300
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(response.status).json({ error: 'OpenRouter error: ' + errText });
    }

    const data = await response.json();

    // Ambil teks dari response OpenRouter
    const rawText = data?.choices?.[0]?.message?.content || '';
    if (!rawText) return res.status(500).json({ error: 'Respons AI kosong' });

    // Bersihkan dan ekstrak JSON
    const cleaned = rawText.replace(/```json|```/g, '').trim();
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return res.status(500).json({ error: 'Format respons tidak valid: ' + cleaned.substring(0, 100) });

    const hasil = JSON.parse(jsonMatch[0]);
    return res.status(200).json({ hasil });

  } catch (err) {
    console.error('scan-nota error:', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
}
