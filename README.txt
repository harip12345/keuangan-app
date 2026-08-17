Ikon Finance App by Haripam - untuk di-deploy ke Vercel
=======================================================

Letakkan SEMUA file ini di ROOT project Vercel (folder yang sama dengan index.html):

  index.html
  manifest.webmanifest
  icon.svg
  icon-192.png
  icon-512.png
  icon-maskable-512.png
  apple-touch-icon.png
  favicon-32.png   (opsional)

index.html sudah otomatis menautkan:
  <link rel="manifest" href="/manifest.webmanifest">
  <link rel="apple-touch-icon" href="/apple-touch-icon.png">

Cara pakai di HP:
- Android (Chrome): buka situs -> menu -> "Add to Home screen" / "Install app".
- iPhone (Safari): buka situs -> Share -> "Add to Home Screen".
  (iOS memakai apple-touch-icon.png 180x180.)

Catatan: ikon home screen butuh diakses lewat HTTPS (domain Vercel), bukan file lokal.

FITUR BOT TELEGRAM (input transaksi via chat)
===========================================

1. Bikin bot lewat @BotFather di Telegram (gratis, resmi) -> dapatkan token.
2. Di Vercel, set Environment Variables:
   - TELEGRAM_BOT_TOKEN        = token dari BotFather (wajib)
   - TELEGRAM_WEBHOOK_SECRET   = string rahasia bebas (opsional, disarankan)
   - TELEGRAM_SERVICE_KEY      = string rahasia bebas (untuk daftarkan webhook)
   - FIREBASE_PROJECT_ID       = ID project Firebase (wajib)
   - FIREBASE_CLIENT_EMAIL     = email service account Firebase (wajib)
   - FIREBASE_PRIVATE_KEY      = private key service account (wajib, simpan utuh
                                  dengan \n; Vercel otomatis menambahkan "-----BEGIN..." )
   Catatan: FIREBASE_* diambil dari Firebase Console -> Project Settings ->
   Service Accounts -> Generate new private key. GROQ_API_KEY / GEMINI_API_KEY
   (sudah dipakai scan nota) juga dibutuhkan untuk scan foto via bot.
3. Setelah deploy, daftarkan webhook sekali:
   curl -X POST https://<domain-vercel>/api/telegram-register-webhook \
        -H "Content-Type: application/json" \
        -H "x-service-key: <TELEGRAM_SERVICE_KEY>" \
        -d '{"action":"set"}'
   (Ulangi jika ganti domain Vercel.)
4. Di app: login -> Pengaturan -> "Hubungkan Bot Telegram" -> tap "Buka Telegram
   & Kirim Kode". Chat otomatis terikat ke profil yang sedang login.
5. Contoh perintah di bot: "makan 50000", "ngopi 25rb", "gaji 3jt",
   "transfer 100rb dari tunai ke bsi", "kemarin ojek 20rb", "saldo", "riwayat",
   plus foto nota untuk scan otomatis.

Struktur file baru:
- api/_lib/            (firebaseAdmin, bindings, waParser, scanNota)
- api/gen-link.js      (kode pairing / status / putus koneksi)
- api/telegram-webhook.js (otak bot)
- api/telegram-register-webhook.js
