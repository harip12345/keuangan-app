// Webhook bot Telegram — menerima pesan masuk, mengikat chat ke profil, mencatat transaksi
// (teks bebas / foto nota), dan membalas konfirmasi otomatis.
import { getDb, BOT_COLLECTION, FieldValue } from './_lib/firebaseAdmin.js';
import { getBindingByChat, getBindingByProfile, setBinding, removeBinding, getPending, deletePending } from './_lib/bindings.js';
import { extractNota } from './_lib/scanNota.js';
import {
  ymdToCustom, parseAmount, parseDate, detectType, detectCategory, detectWallet,
  isTransferSyntax, parseTransfer, cleanNote, formatRupiah
} from './_lib/waParser.js';

export const config = { maxDuration: 60 };

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function tgApi(method, params = {}) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN belum di-set di Vercel');
  const resp = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params)
  });
  const data = await resp.json();
  if (!data.ok) throw new Error(`Telegram ${method}: ${data.description || resp.status}`);
  return data.result;
}

async function sendMessage(chatId, text) {
  return tgApi('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true });
}

const HELP_TEXT = `📋 <b>Cara Pakai Bot</b>

Kirim pesan singkat, contoh:
• <code>makan 50000</code>
• <code>ngopi 25rb di starbucks</code>
• <code>gaji 3jt</code>
• <code>transfer 100rb dari tunai ke bsi</code>
• <code>kemarin ojek 20rb</code> (tanggal otomatis)
• Foto nota/struk → otomatis discan & dicatat

Perintah lain:
• <code>saldo</code> — ringkasan keuangan
• <code>riwayat</code> — 10 transaksi terakhir
• <code>status</code> — profil yang terhubung
• <code>unbind</code> — putuskan koneksi
• <code>help</code> — bantuan ini`;

function typeLabel(type) {
  return type === 'income' ? 'Pemasukan' : type === 'transfer' ? 'Transfer' : 'Pengeluaran';
}

function iconFor(data) {
  if (data.type === 'income') return '🟢';
  if (data.type === 'transfer') return '🔁';
  return '🔴';
}

function kategoriLabel(data) {
  if (data.type === 'income') return data.category;
  if (data.type === 'transfer') return 'Transfer Mutasi';
  if (data.category === 'Lainnya' && data.kategori_custom) return data.kategori_custom;
  return data.category;
}

function rincianText(data) {
  const lines = [
    `${iconFor(data)} <b>${typeLabel(data.type)} tercatat!</b>`,
    `• Kategori: <b>${escapeHtml(kategoriLabel(data))}</b>`,
    `• Nominal: <b>${formatRupiah(data.amount)}</b>`,
    `• Wallet: ${escapeHtml(data.wallet)}`,
    `• Tanggal: ${escapeHtml(data.date)}`
  ];
  if (data.type === 'transfer' && data.walletTo) lines.push(`• Tujuan: ${escapeHtml(data.walletTo)}`);
  if (data.note) lines.push(`• Catatan: ${escapeHtml(data.note)}`);
  lines.push('');
  lines.push('Balas <code>saldo</code> untuk cek saldo terkini.');
  return lines.join('\n');
}

async function saveTransaction(profileId, data) {
  return getDb().collection(BOT_COLLECTION).doc(profileId).collection('transactions').add({
    ...data,
    timestamp: FieldValue.serverTimestamp(),
    source: 'telegram'
  });
}

async function getSummary(profileId) {
  const snap = await getDb().collection(BOT_COLLECTION).doc(profileId).collection('transactions').get();
  let totalIncome = 0, totalExpense = 0;
  const perWallet = {};
  for (const doc of snap.docs) {
    const d = doc.data();
    const amount = Number(d.amount) || 0;
    if (d.type === 'income') {
      totalIncome += amount;
      perWallet[d.wallet || 'Tunai'] = (perWallet[d.wallet || 'Tunai'] || 0) + amount;
    } else if (d.type === 'expense') {
      totalExpense += amount;
      perWallet[d.wallet || 'Tunai'] = (perWallet[d.wallet || 'Tunai'] || 0) - amount;
    }
  }
  return { totalIncome, totalExpense, saldo: totalIncome - totalExpense, perWallet };
}

function summaryText(sum, wsEntries) {
  const lines = [
    '💰 <b>Ringkasan Keuangan</b>',
    `• Pemasukan: <b>${formatRupiah(sum.totalIncome)}</b>`,
    `• Pengeluaran: <b>-${formatRupiah(sum.totalExpense)}</b>`,
    `• Saldo Total: <b>${formatRupiah(sum.saldo)}</b>`,
    ''
  ];
  if (wsEntries.length) {
    lines.push('<b>Saldo per Wallet:</b>');
    for (const [w, v] of wsEntries) {
      lines.push(`• ${escapeHtml(w)}: <b>${formatRupiah(v)}</b>`);
    }
  } else {
    lines.push('Belum ada transaksi tercatat.');
  }
  return lines.join('\n');
}

async function handlePhoto(msg, chatId, binding) {
  const photo = msg.photo && msg.photo[msg.photo.length - 1];
  if (!photo) return sendMessage(chatId, 'Foto tidak bisa diproses. Coba kirim ulang.');
  await sendMessage(chatId, '🖼️ Menganalisis nota...');
  try {
    const file = await tgApi('getFile', { file_id: photo.file_id });
    if (!file.file_path) throw new Error('file_path kosong');
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const resp = await fetch(`https://api.telegram.org/file/bot${token}/${file.file_path}`);
    if (!resp.ok) throw new Error('Gagal mengunduh foto');
    const buf = Buffer.from(await resp.arrayBuffer());
    const imageBase64 = buf.toString('base64');

    const result = await extractNota(
      process.env.GROQ_API_KEY,
      process.env.GEMINI_API_KEY,
      imageBase64,
      'image/jpeg'
    );
    const h = result.hasil;
    const kategori = h.kategori === 'Lainnya' && h.kategori_custom ? h.kategori_custom : h.kategori;
    const data = {
      type: h.type,
      category: kategori,
      amount: Number(h.nominal) || 0,
      wallet: h.wallet,
      note: h.keterangan || 'Scan nota',
      date: ymdToCustom(h.tanggal) || ymdToCustom(new Date().toISOString().split('T')[0])
    };
    if (!data.amount || data.amount <= 0) {
      return sendMessage(chatId, '⚠️ Nominal tidak terbaca jelas dari foto. Ketik manual contoh: <code>makan 50000</code>');
    }
    await saveTransaction(binding.profileId, data);
    const text = rincianText(data) + `\n<i>(Sumber: Scan Nota · ${result.provider.toUpperCase()})</i>`;
    return sendMessage(chatId, text);
  } catch (err) {
    return sendMessage(chatId, '❌ Gagal memproses foto: ' + escapeHtml(err.message));
  }
}

async function handleBind(chatId, code, nameFromChat) {
  if (!code) {
    return sendMessage(chatId, 'Masukkan kode: <code>link 123456</code>\nKode bisa dibuat dari app: Pengaturan → Hubungkan Bot.');
  }
  const pending = await getPending(code);
  if (!pending) {
    return sendMessage(chatId, '❌ Kode tidak ditemukan. Pastikan kode 6 digit benar dan belum kedaluwarsa (berlaku 10 menit).');
  }
  if (Date.now() > pending.expiresAt) {
    await deletePending(code);
    return sendMessage(chatId, '⏰ Kode sudah kedaluwarsa. Buat kode baru dari app.');
  }
  const existing = await getBindingByProfile(pending.profileId);
  if (existing && String(existing.chatId) !== String(chatId)) {
    return sendMessage(chatId, '❌ Profil ini sudah terikat ke chat lain. Putuskan dulu dari app (Pengaturan → Putuskan Koneksi).');
  }
  await setBinding(pending.profileId, chatId, pending.name || nameFromChat || 'User');
  await deletePending(code);
  return sendMessage(chatId, `✅ <b>Terhubung!</b>\nChat ini sekarang terikat ke profil <b>${escapeHtml(pending.name || 'User')}</b>.\n\nMulai catat, contoh: <code>makan 50000</code>\nBalas <code>help</code> untuk bantuan.`);
}

async function handleTransaction(chatId, text, binding) {
  const rawText = cleanNote(text);
  let type = detectType(text);
  let category, wallet, walletTo;

  if (type === 'transfer' && isTransferSyntax(text)) {
    const tr = parseTransfer(text);
    wallet = tr.wallet;
    walletTo = tr.walletTo;
    category = 'Transfer Mutasi';
    if (!walletTo) {
      type = detectType(text.replace(/\b(dari|ke)\b/gi, ' '));
      wallet = detectWallet(text);
      category = detectCategory(text, type === 'income' ? 'income' : 'expense');
    }
  } else {
    if (type === 'transfer') type = 'expense';
    category = detectCategory(text, type === 'income' ? 'income' : 'expense');
    wallet = detectWallet(text);
  }

  const { amount } = parseAmount(text);
  if (!amount || amount <= 0) {
    return sendMessage(chatId, '⚠️ Nominal tidak terdeteksi.\nContoh: <code>makan 50000</code>, <code>gaji 3jt</code>, <code>kemarin ojek 20rb</code>');
  }

  const tanggal = parseDate(text);
  const data = { type, category, amount, wallet, note: rawText, date: ymdToCustom(tanggal) };
  if (walletTo) data.walletTo = walletTo;

  await saveTransaction(binding.profileId, data);
  return sendMessage(chatId, rincianText(data));
}

async function handleCommand(chatId, text, binding) {
  const lower = text.toLowerCase().trim();
  const cmd = lower.split(/\s+/)[0];
  const arg = lower.slice(cmd.length).trim();

  if (cmd === '/start' || cmd === 'start') {
    if (arg) return handleBind(chatId, arg.replace(/^link\s*/i, ''), 'User');
    if (binding) return sendMessage(chatId, `Halo! Terhubung ke profil <b>${escapeHtml(binding.name)}</b>.\n\n` + HELP_TEXT);
    return sendMessage(chatId, 'Halo! Belum ada kode ditautkan.\n\nBuka app → Pengaturan → <b>Hubungkan Bot</b> → kirim kodenya ke sini (atau tap tombol di app).\n\n' + HELP_TEXT);
  }
  if (cmd === '/link' || cmd === 'link') {
    return handleBind(chatId, arg, 'User');
  }
  if (['/help', 'help', '/bantuan', 'bantuan', 'menu', '/menu', 'panduan', '/panduan'].includes(cmd)) {
    return sendMessage(chatId, (binding ? `Profil: <b>${escapeHtml(binding.name)}</b>\n\n` : '') + HELP_TEXT);
  }

  if (!binding) {
    return sendMessage(chatId, '⚠️ Chat ini belum terhubung ke profil mana pun.\n\nBuka app → Pengaturan → <b>Hubungkan Bot</b> → kirim kode 6 digit dengan: <code>link 123456</code>');
  }

  if (cmd === '/status' || cmd === 'status' || (cmd === 'cek' && !arg)) {
    return sendMessage(chatId, `🔗 Terhubung ke profil <b>${escapeHtml(binding.name)}</b>\nChat ID: <code>${chatId}</code>`);
  }
  if (cmd === '/unbind' || cmd === 'unbind' || cmd === 'putus') {
    await removeBinding(chatId);
    return sendMessage(chatId, '🔌 Koneksi diputus. Chat ini tidak lagi terikat ke profil mana pun.');
  }
  if (cmd === '/saldo' || cmd === 'saldo' || cmd === 'cek' || cmd === 'cek saldo' || lower === 'cek saldo') {
    const sum = await getSummary(binding.profileId);
    const wsEntries = Object.entries(sum.perWallet).sort((a, b) => b[1] - a[1]);
    return sendMessage(chatId, summaryText(sum, wsEntries));
  }
  if (cmd === '/riwayat' || cmd === 'riwayat' || cmd === 'history' || cmd === 'mutasi' || cmd === '/history') {
    const snap = await getDb().collection(BOT_COLLECTION).doc(binding.profileId).collection('transactions')
      .orderBy('timestamp', 'desc').limit(10).get();
    if (snap.empty) return sendMessage(chatId, 'Belum ada transaksi.');
    const lines = snap.docs.map((doc) => {
      const d = doc.data();
      const amt = formatRupiah(d.amount);
      const cat = kategoriLabel(d);
      return `${iconFor(d)} ${esc(d.type === 'income' ? '+' : d.type === 'transfer' ? '↔' : '-')} <b>${amt}</b> • ${esc(cat)} • ${esc(d.date || '')}`;
    });
    return sendMessage(chatId, '📜 <b>10 Transaksi Terakhir</b>\n\n' + lines.join('\n'));
  }

  return handleTransaction(chatId, text, binding);
}

function esc(s) { return escapeHtml(s); }

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (secret && req.headers['x-telegram-bot-api-secret-token'] !== secret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const update = req.body || {};
  const msg = update.message;
  if (!msg) return res.status(200).end();

  try {
    const chatId = msg.chat ? msg.chat.id : null;
    if (!chatId) return res.status(200).end();
    if (msg.chat.type !== 'private') return res.status(200).end();

    const binding = await getBindingByChat(chatId);
    const text = (msg.text || msg.caption || '').trim();

    if (msg.photo && msg.photo.length > 0) {
      if (!binding) {
        await sendMessage(chatId, '⚠️ Chat ini belum terhubung ke profil mana pun. Buka app → Pengaturan → Hubungkan Bot.');
      } else {
        await handlePhoto(msg, chatId, binding);
      }
      return res.status(200).end();
    }

    if (!text) return res.status(200).end();

    const first = text.toLowerCase().split(/\s+/)[0];
    const isCmd = first.startsWith('/') || ['link', 'help', 'bantuan', 'menu', 'panduan', 'saldo', 'cek', 'riwayat', 'history', 'mutasi', 'status', 'unbind', 'putus', 'start'].includes(first);
    if (isCmd) {
      await handleCommand(chatId, text, binding);
    } else {
      if (!binding) {
        await sendMessage(chatId, '⚠️ Chat ini belum terhubung ke profil mana pun.\n\nBuka app → Pengaturan → <b>Hubungkan Bot</b>, lalu kirim kodenya dengan: <code>link 123456</code>');
      } else {
        await handleTransaction(chatId, text, binding);
      }
    }
  } catch (err) {
    console.error('telegram-webhook error:', err);
    try {
      await sendMessage(msg.chat.id, '❌ Terjadi kesalahan: ' + escapeHtml(err.message));
    } catch (e) { /* abaikan */ }
  }

  return res.status(200).end();
}