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
