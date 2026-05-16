// ===========================
// OFARIN — server.js (STABLE)
// Webhook mode (409 fix)
// ===========================

require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const path       = require('path');
const { MongoClient } = require('mongodb');
const TelegramBot     = require('node-telegram-bot-api');

const app  = express();
const PORT = process.env.PORT || 3000;

const TG_TOKEN    = process.env.TG_TOKEN;
const TG_CHAT     = process.env.TG_CHAT;
const MINIAPP_URL = process.env.MINIAPP_URL || 'https://ofarin-backend-1.onrender.com/miniapp';
const MONGODB_URI = process.env.MONGODB_URI;
const SERVER_URL  = process.env.SERVER_URL  || 'https://ofarin-backend-1.onrender.com';

// ── Middleware ──────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── MongoDB ─────────────────────────────────────────────
let bookingsCol;
let contactsCol;

async function connectDB() {
  try {
    const client = new MongoClient(MONGODB_URI, {
      serverSelectionTimeoutMS: 15000,
      connectTimeoutMS: 15000,
    });
    await client.connect();
    const db  = client.db('ofarin');
    bookingsCol = db.collection('bookings');
    contactsCol = db.collection('contacts');
    console.log('✅ MongoDB ulandi!');
  } catch(e) {
    console.error('❌ MongoDB xato:', e.message);
    setTimeout(connectDB, 5000);
  }
}

// ── Telegram Bot (WEBHOOK mode — 409 muammo yo'q) ──────
const bot = new TelegramBot(TG_TOKEN, { webHook: true });

// Webhook yo'li
const WEBHOOK_PATH = `/webhook/${TG_TOKEN}`;

app.post(WEBHOOK_PATH, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

async function setWebhook() {
  try {
    await bot.setWebHook(`${SERVER_URL}${WEBHOOK_PATH}`);
    console.log('✅ Webhook o\'rnatildi:', `${SERVER_URL}${WEBHOOK_PATH}`);
  } catch(e) {
    console.error('❌ Webhook xato:', e.message);
  }
}

// ── Bot helpers ─────────────────────────────────────────
const MONTHS_UZ  = ['Yanvar','Fevral','Mart','Aprel','May','Iyun','Iyul','Avgust','Sentabr','Oktabr','Noyabr','Dekabr'];
const MONTH_EMOJI= ['❄️','💝','🌸','🌷','🌿','☀️','🌻','🏖','🍂','🎃','🍁','🎄'];
const EVENT_LABELS = {
  wedding:  "💍 To'y",
  birthday: "🎂 Tug'ilgan kun",
  yubiley:  "🌟 Yubiley",
  haj:      "🕌 Haj To'yi",
  banket:   "🥂 Banket"
};

function progressBar(count, max) {
  const filled = max === 0 ? 0 : Math.round((count / max) * 8);
  return '█'.repeat(filled) + '░'.repeat(8 - filled);
}

function getMainKeyboard() {
  return {
    reply_markup: {
      keyboard: [
        [{ text: '📅 Online Bronlar' }, { text: '📋 Offline Bronlar' }],
        [{ text: '📊 Statistika' }]
      ],
      resize_keyboard: true,
      persistent: true
    }
  };
}

async function buildYearStats(year) {
  const allBookings = await bookingsCol.find({ status: { $ne: 'rejected' } }).toArray();
  const counts = Array(12).fill(0);
  allBookings.forEach(b => {
    if (!b.date) return;
    const parts = b.date.split('-');
    if (parseInt(parts[0]) === year) counts[parseInt(parts[1]) - 1]++;
  });

  const total  = counts.reduce((a, b) => a + b, 0);
  const max    = Math.max(...counts, 1);
  const curMon = new Date().getMonth();
  const curYr  = new Date().getFullYear();

  let text = `📊 <b>STATISTIKA — ${year}</b>\n`;
  text += `<i>Tasdiqlangan va kutilayotgan bronlar</i>\n\n`;
  counts.forEach((c, i) => {
    const cur = (year === curYr && i === curMon) ? ' ◄' : '';
    text += `${MONTH_EMOJI[i]} <code>${MONTHS_UZ[i].padEnd(9)}</code> <code>${progressBar(c, max)}</code>  <b>${c}</b>${cur}\n`;
  });
  text += `\n──────────────────\n📅 Jami: <b>${total}</b> ta bron · 📆 <b>${year}</b>`;

  // Month buttons (3 columns)
  const monthBtns = [];
  for (let r = 0; r < 4; r++) {
    const row = [];
    for (let c = 0; c < 3; c++) {
      const i = r * 3 + c;
      const isCur = (year === curYr && i === curMon);
      row.push({
        text: `${MONTH_EMOJI[i]} ${MONTHS_UZ[i]} (${counts[i]})${isCur ? ' ◄' : ''}`,
        callback_data: `month:${year}:${i}`
      });
    }
    monthBtns.push(row);
  }

  const inline_keyboard = [
    [
      { text: `◀ ${year-1}`, callback_data: `year:${year-1}` },
      { text: `${year} ✦`,   callback_data: `year:${year}`   },
      { text: `${year+1} ▶`, callback_data: `year:${year+1}` }
    ],
    ...monthBtns
  ];

  return { text, inline_keyboard };
}

async function buildMonthDetail(year, monthIdx) {
  const monthStr = String(monthIdx + 1).padStart(2, '0');
  const bookings = await bookingsCol.find({
    date: { $regex: `^${year}-${monthStr}` },
    status: { $ne: 'rejected' }
  }).sort({ date: 1, slot: 1 }).toArray();

  const emoji = MONTH_EMOJI[monthIdx];
  const name  = MONTHS_UZ[monthIdx];
  let text    = `${emoji} <b>${name} ${year}</b> — `;

  if (bookings.length === 0) {
    text += `<i>hali bron yo'q</i>`;
  } else {
    text += `<i>${bookings.length} ta bron</i>\n`;
    text += `━━━━━━━━━━━━━━━━━━━━\n\n`;

    // Group by date
    const byDate = {};
    bookings.forEach(b => {
      if (!byDate[b.date]) byDate[b.date] = [];
      byDate[b.date].push(b);
    });

    for (const date of Object.keys(byDate).sort()) {
      const day = parseInt(date.split('-')[2]);
      text += `📅 <b>${day}-${name}</b>\n`;
      for (const b of byDate[date]) {
        const slotIcon = b.slot === 'morning' ? '☀️' : '🌙';
        const slotTime = b.slot === 'morning' ? '09:00–15:00' : '17:00–23:00';
        const status   = b.status === 'confirmed' ? '✅' : '⏳';
        text += `  ${slotIcon} <code>${slotTime}</code>  ${status} ${EVENT_LABELS[b.event] || b.event}\n`;
        text += `  👤 <b>${b.name}</b>  📞 ${b.phone}\n`;
        if (b.guests && b.guests !== '—') text += `  👥 ${b.guests} mehmon\n`;
        text += `\n`;
      }
      text += `─────────────────────\n`;
    }
  }

  const inline_keyboard = [[
    { text: `◀ ${name} ${year} — Orqaga`, callback_data: `year:${year}` }
  ]];

  return { text, inline_keyboard };
}

// ── Bot commands & messages ─────────────────────────────
bot.onText(/\/start/, (msg) => {
  if (String(msg.chat.id) !== String(TG_CHAT)) return;
  bot.sendMessage(TG_CHAT,
    `👋 Salom! <b>Ofarin To'yxonasi</b> admin paneliga xush kelibsiz!`,
    { parse_mode: 'HTML', ...getMainKeyboard() }
  );
});

bot.on('message', async (msg) => {
  if (String(msg.chat.id) !== String(TG_CHAT)) return;
  const text = msg.text;

  if (text === '📅 Online Bronlar') {
    bot.sendMessage(TG_CHAT, '📅 <b>Online bronlar kalendari</b>', {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [[
          { text: '🗓 Kalendarni ochish', web_app: { url: `${MINIAPP_URL}?section=online` } }
        ]]
      }
    });
  }

  if (text === '📋 Offline Bronlar') {
    bot.sendMessage(TG_CHAT, '📋 <b>Offline bronlar</b>\n\n⏳ Bu bo\'lim keyinchalik qo\'shiladi.', { parse_mode: 'HTML' });
  }

  if (text === '📊 Statistika') {
    const year = new Date().getFullYear();
    const { text: t, inline_keyboard } = await buildYearStats(year);
    bot.sendMessage(TG_CHAT, t, { parse_mode: 'HTML', reply_markup: { inline_keyboard } });
  }
});

// ── Callback queries ────────────────────────────────────
bot.on('callback_query', async (query) => {
  if (String(query.message.chat.id) !== String(TG_CHAT)) return;
  await bot.answerCallbackQuery(query.id);

  const parts  = query.data.split(':');
  const action = parts[0];

  // Year navigation
  if (action === 'year') {
    const year = parseInt(parts[1]);
    const { text, inline_keyboard } = await buildYearStats(year);
    await bot.editMessageText(text, {
      chat_id: TG_CHAT, message_id: query.message.message_id,
      parse_mode: 'HTML', reply_markup: { inline_keyboard }
    });
    return;
  }

  // Month detail
  if (action === 'month') {
    const year     = parseInt(parts[1]);
    const monthIdx = parseInt(parts[2]);
    const { text, inline_keyboard } = await buildMonthDetail(year, monthIdx);
    await bot.editMessageText(text, {
      chat_id: TG_CHAT, message_id: query.message.message_id,
      parse_mode: 'HTML', reply_markup: { inline_keyboard }
    });
    return;
  }

  // Booking confirm/reject
  if (action === 'confirm' || action === 'reject') {
    const bookingId = parseInt(parts[1]);
    const status    = action === 'confirm' ? 'confirmed' : 'rejected';
    const booking   = await bookingsCol.findOne({ id: bookingId });
    if (!booking) return;

    await bookingsCol.updateOne({ id: bookingId }, { $set: { status } });

    const icon  = status === 'confirmed' ? '✅' : '❌';
    const label = status === 'confirmed' ? 'TASDIQLANDI' : 'RAD ETILDI';
    await bot.editMessageReplyMarkup(
      { inline_keyboard: [[{ text: `${icon} ${label}`, callback_data: 'done' }]] },
      { chat_id: TG_CHAT, message_id: query.message.message_id }
    );
    const slotLabel = booking.slot === 'morning' ? '☀️ Ertalab' : '🌙 Kechqurun';
    bot.sendMessage(TG_CHAT,
      `${icon} <b>${booking.name}</b> — <b>${booking.date}</b> (${slotLabel}) <b>${label.toLowerCase()}!</b>`,
      { parse_mode: 'HTML' }
    );
    return;
  }

  if (action === 'done') return;
});

// ── API Routes ──────────────────────────────────────────

// Yangi bron
app.post('/api/booking', async (req, res) => {
  if (!bookingsCol) return res.status(503).json({ error: 'DB ulanmagan' });
  const { name, phone, event, slot, date, guests, note } = req.body;
  if (!name || !phone || !event || !slot || !date)
    return res.status(400).json({ error: 'Majburiy maydonlar to\'ldirilmagan' });

  const conflict = await bookingsCol.findOne({ date, slot, status: { $ne: 'rejected' } });
  if (conflict) return res.status(409).json({ error: 'Bu vaqt allaqachon band!' });

  const booking = {
    id: Date.now(), name, phone, event, slot, date,
    guests: guests || '—', note: note || '—',
    status: 'pending', submitted: new Date().toISOString()
  };
  await bookingsCol.insertOne(booking);

  const slotLabel = slot === 'morning' ? '☀️ Ertalab (09:00–15:00)' : '🌙 Kechqurun (17:00–23:00)';
  const tgText =
`🎉 <b>YANGI BRON SO'ROVI</b>
🏛 Ofarin To'yxonasi

👤 <b>Ism:</b> ${name}
📞 <b>Telefon:</b> ${phone}
📅 <b>Sana:</b> ${date}
🕐 <b>Vaqt:</b> ${slotLabel}
🎊 <b>Tadbir:</b> ${EVENT_LABELS[event] || event}
👥 <b>Mehmonlar:</b> ${guests || '—'}
📝 <b>Izoh:</b> ${note || '—'}`;

  await bot.sendMessage(TG_CHAT, tgText, {
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [[
        { text: '✅ Tasdiqlash', callback_data: `confirm:${booking.id}` },
        { text: '❌ Rad etish',  callback_data: `reject:${booking.id}`  }
      ]]
    }
  });
  res.json({ success: true, id: booking.id });
});

// Kontakt
app.post('/api/contact', async (req, res) => {
  if (!contactsCol) return res.status(503).json({ error: 'DB ulanmagan' });
  const { name, phone, message } = req.body;
  if (!name || !phone || !message)
    return res.status(400).json({ error: 'Barcha maydonlar to\'ldirilishi shart' });

  await contactsCol.insertOne({ name, phone, message, date: new Date().toISOString() });
  await bot.sendMessage(TG_CHAT,
    `💬 <b>YANGI XABAR</b>\n\n👤 <b>${name}</b>\n📞 ${phone}\n📝 ${message}`,
    { parse_mode: 'HTML' }
  );
  res.json({ success: true });
});

// Barcha bronlar
app.get('/api/bookings', async (req, res) => {
  if (!bookingsCol) return res.json([]);
  const bookings = await bookingsCol.find({}, { projection: { _id: 0 } }).toArray();
  res.json(bookings);
});

// Bron statusini yangilash
app.post('/api/booking/:id/status', async (req, res) => {
  if (!bookingsCol) return res.status(503).json({ error: 'DB ulanmagan' });
  const { id } = req.params;
  const { status } = req.body;
  const result = await bookingsCol.updateOne({ id: parseInt(id) }, { $set: { status } });
  if (result.matchedCount === 0) return res.status(404).json({ error: 'Topilmadi' });
  res.json({ success: true });
});

// Bron o'chirish
app.delete('/api/booking/:id', async (req, res) => {
  if (!bookingsCol) return res.status(503).json({ error: 'DB ulanmagan' });
  await bookingsCol.deleteOne({ id: parseInt(req.params.id) });
  res.json({ success: true });
});

// Mini App
app.get('/miniapp', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'miniapp.html'));
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', db: bookingsCol ? 'connected' : 'disconnected' });
});

// ── Start ───────────────────────────────────────────────
app.listen(PORT, async () => {
  console.log(`✅ Server ishlamoqda: http://localhost:${PORT}`);
  await connectDB();
  await setWebhook();
});
