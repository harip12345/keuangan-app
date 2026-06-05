export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { imageBase64, mimeType } = req.body;
  if (!imageBase64) return res.status(400).json({ error: 'No image' });

  const apiKey = process.env.GEMINI_API_KEY;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/` +
    `gemini-1.5-flash:generateContent?key=${apiKey}`;

  const prompt = `Baca nota/struk ini. Balas HANYA dengan JSON:
{
  "tanggal": "YYYY-MM-DD",
  "nominal": 75000,
  "keterangan": "deskripsi singkat",
  "kategori": "Makanan & Minuman"
}
Kategori: Makanan & Minuman, Transport, Belanja,
Kesehatan, Hiburan, Tagihan, Lainnya.
Nominal = angka bulat. Jika tanggal tidak ada, pakai hari ini.`;

  const geminiRes = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [
        { text: prompt },
        { inline_data: { mime_type: mimeType, data: imageBase64 } }
      ]}],
      generationConfig: { temperature: 0.1, maxOutputTokens: 200 }
    })
  });

  const data = await geminiRes.json();
  res.status(200).json(data);
}
