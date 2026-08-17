// Parser perintah bot — port persis dari fitur "Catat Cepat" di index.html
// (fungsi _qaParseAmount / _qaParseDate / _qaDetectType / _qaCategory) + wallet & transfer.

const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agt', 'Sep', 'Okt', 'Nov', 'Des'];

export function ymdToCustom(ymdStr) {
  if (!ymdStr) return null;
  const parts = ymdStr.split('-');
  if (parts.length !== 3) return null;
  const y = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  const d = parseInt(parts[2], 10);
  if (!y || !m || !d) return null;
  return `${d} ${MONTHS[m] || ''} ${y}`;
}

function isWord(c) { return (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9'); }

function has(t, w) {
  w = (w || '').trim();
  if (!w) return false;
  let i = t.indexOf(w);
  while (i >= 0) {
    const b = i === 0 ? ' ' : t.charAt(i - 1);
    const a = t.charAt(i + w.length) || ' ';
    if (!isWord(b) && !isWord(a)) return true;
    i = t.indexOf(w, i + 1);
  }
  return false;
}

function jakartaNowYMD() {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' });
  const parts = fmt.formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t)?.value || '';
  const y = get('year'), m = get('month'), d = get('day');
  return Date.UTC(Number(y), Number(m) - 1, Number(d));
}

function ymdFromMs(ms) {
  const dt = new Date(ms);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

export function parseAmount(text) {
  const t = ' ' + text.toLowerCase().replace(/rp\.?/g, ' ') + ' ';
  let m;
  const special = [
    [/\bseratus\s*(?:ribu|rb)\b/, 100000],
    [/\bsetengah\s*juta\b/, 500000],
    [/\b(?:se|satu)\s*juta\b/, 1000000],
    [/\bseribu\b/, 1000]
  ];
  for (let i = 0; i < special.length; i++) {
    if (special[i][0].test(t)) return { amount: special[i][1], matched: (t.match(special[i][0]) || [''])[0].trim() };
  }
  m = t.match(/(\d+(?:[.,]\d+)?)\s*ratus\s*(?:ribu|rb)/);
  if (m) return { amount: Math.round(parseFloat(m[1].replace(',', '.')) * 100000), matched: m[0].trim() };
  m = t.match(/(\d+(?:[.,]\d+)?)\s*puluh\s*(?:ribu|rb)/);
  if (m) return { amount: Math.round(parseFloat(m[1].replace(',', '.')) * 10000), matched: m[0].trim() };
  m = t.match(/(\d+(?:[.,]\d+)?)\s*(jt|juta|jeti|rb|ribu|k|miliar|milyar)\b/);
  if (m) {
    const n = parseFloat(m[1].replace(',', '.'));
    const s = m[2];
    let mult = 1;
    if (s === 'rb' || s === 'ribu' || s === 'k') mult = 1000;
    else if (s === 'jt' || s === 'juta' || s === 'jeti') mult = 1000000;
    else mult = 1000000000;
    return { amount: Math.round(n * mult), matched: m[0].trim() };
  }
  const nums = t.match(/\d[\d.,]*\d|\d/g) || [];
  let best = 0, bestStr = '';
  for (let j = 0; j < nums.length; j++) {
    const raw = nums[j].trim();
    const v = parseInt(raw.replace(/[.,]/g, ''), 10);
    if (!isNaN(v) && v > best) { best = v; bestStr = raw; }
  }
  if (best > 0) return { amount: best, matched: bestStr };
  return { amount: 0, matched: '' };
}

export function parseDate(text) {
  const t = ' ' + text.toLowerCase() + ' ';
  const todayMs = jakartaNowYMD();
  const bmap = { januari: 1, jan: 1, februari: 2, feb: 2, pebruari: 2, maret: 3, mar: 3, mrt: 3, april: 4, apr: 4, mei: 5, juni: 6, jun: 6, juli: 7, jul: 7, agustus: 8, agt: 8, agu: 8, agst: 8, ags: 8, september: 9, sep: 9, sept: 9, oktober: 10, okt: 10, november: 11, nov: 11, nop: 11, desember: 12, des: 12 };
  const DAY = 86400000;
  if (/\b(kemarin|kemaren)\s+lusa\b/.test(t)) return ymdFromMs(todayMs - 2 * DAY);
  if (/\b(kemarin|kemaren|kmrn|kmren)\b/.test(t)) return ymdFromMs(todayMs - DAY);
  if (/\b(besok|bsk|esok)\b/.test(t)) return ymdFromMs(todayMs + DAY);
  if (/\blusa\b/.test(t)) return ymdFromMs(todayMs + 2 * DAY);
  let m = t.match(/(\d+)\s*hari\s*(?:yang\s*)?lalu/);
  if (m) return ymdFromMs(todayMs - parseInt(m[1], 10) * DAY);
  m = t.match(/\b(\d{1,2})\s+([a-z]+)\b/);
  if (m && bmap[m[2]]) {
    const d1 = parseInt(m[1], 10);
    if (d1 >= 1 && d1 <= 31) return ymdFromMs(Date.UTC(new Date(todayMs).getUTCFullYear(), bmap[m[2]] - 1, d1));
  }
  m = t.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (m) {
    const dA = parseInt(m[1], 10), mA = parseInt(m[2], 10), yA = m[3] ? parseInt(m[3], 10) : new Date(todayMs).getUTCFullYear();
    const yy = yA < 100 ? yA + 2000 : yA;
    if (dA >= 1 && dA <= 31 && mA >= 1 && mA <= 12) return ymdFromMs(Date.UTC(yy, mA - 1, dA));
  }
  m = t.match(/\bt(?:gl|anggal)\.?\s*(\d{1,2})\b/);
  if (m) {
    const dB = parseInt(m[1], 10);
    if (dB >= 1 && dB <= 31) return ymdFromMs(Date.UTC(new Date(todayMs).getUTCFullYear(), new Date(todayMs).getUTCMonth(), dB));
  }
  return ymdFromMs(todayMs);
}

export function detectType(text) {
  const t = ' ' + text.toLowerCase() + ' ';
  if (/\b(transfer|tf|mutasi|pindah|pindahin|pindahkan)\b/.test(t)) return 'transfer';
  const inc = [['gaji', 4], ['gajian', 4], ['upah', 4], ['thr', 4], ['bonus', 4], ['dividen', 4], ['omzet', 3], ['omset', 3], ['cashback', 3], ['refund', 3], ['honor', 3], ['komisi', 3], ['insentif', 3], ['pencairan', 3], ['warisan', 3], ['reward', 2], ['terima', 2], ['diterima', 2], ['dapat', 2], ['dapet', 2], ['dikasih', 2], ['dikasi', 2], ['hadiah', 2], ['jual', 2], ['jualan', 2], ['penjualan', 2], ['untung', 2], ['laba', 2], ['bunga', 2], ['saku', 2], ['pemberian', 2], ['bayaran', 2], ['angpao', 2], ['angpau', 2]];
  const exp = [['beli', 4], ['bayar', 4], ['jajan', 3], ['belanja', 3], ['makan', 2], ['minum', 2], ['ngopi', 3], ['topup', 2], ['bensin', 3], ['ojek', 3], ['grab', 2], ['gojek', 2], ['parkir', 3], ['kuota', 3], ['wifi', 2], ['pulsa', 3], ['langganan', 3], ['sewa', 3], ['cicilan', 3], ['nyicil', 3], ['tagihan', 3], ['nonton', 2], ['tiket', 2], ['servis', 2], ['service', 2], ['laundry', 2], ['infak', 3], ['sedekah', 3], ['zakat', 3], ['kado', 2], ['traktir', 3], ['nabung', 2]];
  let si = 0, so = 0;
  for (let k = 0; k < inc.length; k++) { if (has(t, inc[k][0])) si += inc[k][1]; }
  for (let k = 0; k < exp.length; k++) { if (has(t, exp[k][0])) so += exp[k][1]; }
  return si > so ? 'income' : 'expense';
}

export function detectCategory(text, kind) {
  const t = ' ' + text.toLowerCase() + ' ';
  const expMap = [
    [['ngopi', 'kopi', 'coffee', 'starbucks', 'kafe', 'cafe'], 'Ngopi'],
    [['makan', 'minum', 'sarapan', 'nasi', 'ayam', 'bakso', 'mie', 'warteg', 'resto', 'restoran', 'gofood', 'grabfood', 'sate', 'soto', 'martabak', 'seblak', 'dinner', 'lunch', 'makanan', 'minuman'], 'Makan dan Minum'],
    [['jajan', 'snack', 'cemilan', 'camilan', 'permen', 'coklat'], 'Jajan'],
    [['bensin', 'pertalite', 'pertamax', 'solar', 'bbm', 'dexlite'], 'Bensin'],
    [['oli', 'ganti oli'], 'Ganti Oli'],
    [['ojek', 'ojol', 'gojek', 'grab', 'gocar', 'grabbike', 'grabcar', 'angkot', 'busway', 'transjakarta', 'mrt', 'krl', 'kereta', 'taksi', 'taxi', 'maxim', 'indriver'], 'Ojek'],
    [['parkir'], 'Parkir'],
    [['kuota', 'wifi', 'internet', 'pulsa', 'indihome', 'paket data'], 'Kuota/Wifi'],
    [['sunscreen', 'sunblock'], 'Sunscreen'],
    [['skincare', 'serum', 'toner', 'moisturizer', 'pelembab', 'retinol', 'niacinamide'], 'Skincare'],
    [['sabun muka', 'facial wash', 'facial'], 'Sabun Muka'],
    [['body care', 'bodycare', 'lotion', 'sabun mandi', 'deodoran', 'parfum'], 'Body care'],
    [['make up', 'makeup', 'lipstik', 'lipstick', 'bedak', 'foundation', 'maskara', 'eyeliner'], 'Make up'],
    [['shopping', 'belanja', 'baju', 'celana', 'sepatu', 'tas', 'fashion', 'kaos', 'jaket', 'dress', 'hijab', 'sandal'], 'Shopping'],
    [['dating', 'ngedate', 'pacar'], 'Dating'],
    [['jalan-jalan', 'jalan jalan', 'liburan', 'wisata', 'travel', 'healing', 'piknik'], 'Jalan-jalan'],
    [['infak', 'sedekah', 'zakat', 'donasi', 'sumbangan', 'amal'], 'Infak'],
    [['ngasih ortu', 'orang tua', 'ke ortu', 'buat ortu', 'ortu'], 'Ngasih Ortu'],
    [['nabung', 'menabung', 'tabungan'], 'Tabungan']
  ];
  const incMap = [
    [['gaji', 'gajian', 'upah'], 'Gaji / Upah'],
    [['thr', 'bonus', 'insentif', 'reward'], 'Bonus / THR'],
    [['usaha', 'bisnis', 'jualan', 'jual', 'dagang', 'omzet', 'omset', 'untung', 'laba', 'penjualan', 'order'], 'Hasil Usaha / Bisnis'],
    [['pencairan', 'dividen', 'bunga', 'reksadana', 'saham', 'investasi', 'obligasi'], 'Pencairan Investasi'],
    [['uang saku', 'saku', 'dikasih', 'dikasi', 'pemberian', 'hadiah', 'kado', 'angpao', 'angpau', 'warisan'], 'Pemberian / Uang Saku']
  ];
  const map = kind === 'income' ? incMap : expMap;
  for (let i = 0; i < map.length; i++) {
    const arr = map[i][0];
    for (let j = 0; j < arr.length; j++) {
      if (has(t, arr[j])) return map[i][1];
    }
  }
  return 'Lainnya';
}

const WALLET_RULES = [
  [['muamalat'], 'Muamalat'],
  [['bsi', 'bank syariah'], 'BSI'],
  [['jago'], 'Bank Jago'],
  [['seabank', 'sea bank'], 'SeaBank'],
  [['blu'], 'Blu'],
  [['gopay', 'ovo', 'dana', 'qris', 'shopeepay', 'shopee pay', 'linkaja', 'spaylater', 'ewallet', 'e-wallet', 'wallet digital'], 'e-Wallet'],
  [['tunai', 'cash'], 'Tunai']
];

export function detectWallet(text) {
  const t = ' ' + text.toLowerCase() + ' ';
  for (const [keys, wallet] of WALLET_RULES) {
    for (const k of keys) {
      if (has(t, k)) return wallet;
    }
  }
  return 'Tunai';
}

export function isTransferSyntax(text) {
  const t = ' ' + text.toLowerCase() + ' ';
  return /\b(transfer|tf|mutasi|pindah|pindahin|pindahkan)\b/.test(t) && /\bke\b/.test(t);
}

export function parseTransfer(text) {
  const t = ' ' + text.toLowerCase() + ' ';
  const m = t.match(/\bdari\s+([a-z0-9 -]+?)\s+ke\s+([a-z0-9 -]+)/);
  if (!m) return { wallet: detectWallet(text), walletTo: null };
  const hasKeyword = (seg) => WALLET_RULES.some(([keys]) => keys.some((k) => has(' ' + seg + ' ', k)));
  const wallet = hasKeyword(m[1]) ? detectWallet(m[1]) : detectWallet(text);
  const walletTo = hasKeyword(m[2]) ? detectWallet(m[2]) : 'Tunai';
  return { wallet, walletTo };
}

export function cleanNote(text) {
  return text.replace(/rp\.?/gi, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
}

export function formatRupiah(n) {
  return 'Rp' + Number(n).toLocaleString('id-ID');
}