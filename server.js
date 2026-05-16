// ===========================
// OFARIN — server.js
// Express + Telegram Bot + MongoDB
// ===========================

require('dotenv').config();
const express   = require('express');
const cors      = require('cors');
const path      = require('path');
const { MongoClient, ObjectId } = require('mongodb');
const TelegramBot = require('node-telegram-bot-api');

const app  = express();
const PORT = process.env.PORT || 3000;

const TG_TOKEN    = process.env.TG_TOKEN;
const TG_CHAT     = process.env.TG_CHAT;
const MINIAPP_URL = process.env.MINIAPP_URL || 'https://ofarin-backend-1.onrender.com/miniapp';
const MONGODB_URI = process.env.MONGODB_URI;

// ── Middleware ──────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── MongoDB connection ──────────────────────────────────
let db;
let bookingsCol;
let contactsCol;

async function connectDB() {
  try {
    const client = new MongoClient(MONGODB_URI, {
      tls: true,
      tlsAllowInvalidCertificates: false,
      serverSelectionTimeoutMS: 10000,
      connectTimeoutMS: 10000,
      retryWrites: true,
    });
    await client.connect();
    db = client.db('ofarin');
    bookingsCol = db.collection('bookings');
    contactsCol = db.collection('contacts');
    console.log('✅ MongoDB ga ulandi!');
  } catch(e) {
    console.error('❌ MongoDB ulanishda xatolik:', e.message);
    // 5 soniyadan keyin qayta urinish
    console.log('⏳ 5 soniyadan keyin qayta uriniladi...');
    setTimeout(connectDB, 5000);
  }
}

// ── Telegram Bot ────────────────────────────────────────
const bot = new TelegramBot(TG_TOKEN, { polling: true });

bot.onText(/\/start/, (msg) => {
  if (String(msg.chat.id) !== String(TG_CHAT)) return;
  bot.sendMessage(TG_CHAT,
    '👋 Salom! <b>Ofarin To\'yxonasi</b> admin paneliga xush kelibsiz!\n\nQuyidagi menyudan foydalaning:',
    {
      parse_mode: 'HTML',
      reply_markup: {
        keyboard: [
          [{ text: '📅 Online Bronlar' }, { text: '📋 Offline Bronlar' }],
          [{ text: '📊 Statistika' }]
        ],
        resize_keyboard: true,
        persistent: true
      }
    }
  );
});

bot.on('message', async (msg) => {
  if (String(msg.chat.id) !== String(TG_CHAT)) return;
  const text = msg.text;

  if (text === '📅 Online Bronlar') {
    bot.sendMessage(TG_CHAT,
      '📅 <b>Online bronlar kalendari</b>\nQuyidagi tugmani bosing:',
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [[
            { text: '🗓 Kalendarni ochish', web_app: { url: `${MINIAPP_URL}?section=online` } }
          ]]
        }
      }
    );
  }

  if (text === '📋 Offline Bronlar') {
    bot.sendMessage(TG_CHAT,
      '📋 <b>Offline bronlar</b>\n\n⏳ Bu bo\'lim keyinchalik qo\'shiladi.',
      { parse_mode: 'HTML' }
    );
  }

  if (text === '📊 Statistika') {
    await sendYearStats(null);
  }
});

// ── Statistika helper ──────────────────────────────────
const MONTHS_UZ = ['Yanvar','Fevral','Mart','Aprel','May','Iyun','Iyul','Avgust','Sentabr','Oktabr','Noyabr','Dekabr'];
const MONTH_EMOJI = ['❄️','💝','🌸','🌷','🌿','☀️','🌻','🏖','🍂','🎃','🍁','🎄'];

function progressBar(count, max) {
  const filled = max === 0 ? 0 : Math.round((count / max) * 8);
  const empty  = 8 - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
}

async function sendYearStats(msgId) {
  const year = new Date().getFullYear();
  const allBookings = await bookingsCol.find({ status: { $ne: 'rejected' } }).toArray();

  // Count per month
  const monthlyCounts = Array(12).fill(0);
  allBookings.forEach(b => {
    if (!b.date) return;
    const m = parseInt(b.date.split('-')[1]) - 1;
    const y = parseInt(b.date.split('-')[0]);
    if (y === year) monthlyCounts[m]++;
  });

  const total = monthlyCounts.reduce((a, b) => a + b, 0);
  const max   = Math.max(...monthlyCounts, 1);
  const currentMonth = new Date().getMonth();

  let text = `📊 <b>STATISTIKA — ${year}</b>\n`;
  text += `<i>Tasdiqlangan va kutilayotgan bronlar</i>\n\n`;

  monthlyCounts.forEach((count, i) => {
    const bar     = progressBar(count, max);
    const emoji   = MONTH_EMOJI[i];
    const name    = MONTHS_UZ[i].padEnd(9, ' ');
    const current = i === currentMonth ? ' ◄' : '';
    text += `${emoji} <code>${name}</code> <code>${bar}</code>  <b>${count}</b>${current}\n`;
  });

  text += `\n──────────────────\n`;
  text += `📅 Jami bronlar: <b>${total}</b>\n`;
  text += `📆 Yil: <b>${year}</b>`;

  // Month buttons (3 columns x 4 rows)
  const monthButtons = [];
  for (let row = 0; row < 4; row++) {
    const rowBtns = [];
    for (let col = 0; col < 3; col++) {
      const i = row * 3 + col;
      const cnt = monthlyCounts[i];
      const isCurrent = i === currentMonth;
      const label = isCurrent
        ? `${MONTH_EMOJI[i]} ${MONTHS_UZ[i]} (${cnt}) ◄`
        : `${MONTH_EMOJI[i]} ${MONTHS_UZ[i]} (${cnt})`;
      rowBtns.push({ text: label, callback_data: `stats_month:${year}:${i}` });
    }
    monthButtons.push(rowBtns);
  }

  // Year nav row
  const inline_keyboard = [
    [
      { text: `◀ ${year-1}`, callback_data: `stats_year:${year-1}` },
      { text: `${year} ✦`,   callback_data: `stats_year:${year}`   },
      { text: `${year+1} ▶`, callback_data: `stats_year:${year+1}` }
    ],
    ...monthButtons
  ];

  if (msgId) {
    await bot.editMessageText(text, {
      chat_id: TG_CHAT, message_id: msgId,
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard }
    });
  } else {
    await bot.sendMessage(TG_CHAT, text, {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard }
    });
  }
}

async function sendYearStatsByYear(year, msgId) {
  const allBookings = await bookingsCol.find({ status: { $ne: 'rejected' } }).toArray();

  const monthlyCounts = Array(12).fill(0);
  allBookings.forEach(b => {
    if (!b.date) return;
    const m = parseInt(b.date.split('-')[1]) - 1;
    const y = parseInt(b.date.split('-')[0]);
    if (y === year) monthlyCounts[m]++;
  });

  const total = monthlyCounts.reduce((a, b) => a + b, 0);
  const max   = Math.max(...monthlyCounts, 1);
  const currentYear  = new Date().getFullYear();
  const currentMonth = new Date().getMonth();

  let text = `📊 <b>STATISTIKA — ${year}</b>\n`;
  text += `<i>Tasdiqlangan va kutilayotgan bronlar</i>\n\n`;

  monthlyCounts.forEach((count, i) => {
    const bar     = progressBar(count, max);
    const emoji   = MONTH_EMOJI[i];
    const name    = MONTHS_UZ[i].padEnd(9, ' ');
    const current = (year === currentYear && i === currentMonth) ? ' ◄' : '';
    text += `${emoji} <code>${name}</code> <code>${bar}</code>  <b>${count}</b>${current}\n`;
  });

  text += `\n──────────────────\n`;
  text += `📅 Jami bronlar: <b>${total}</b>\n`;
  text += `📆 Yil: <b>${year}</b>`;

  // Month buttons
  const monthButtons = [];
  for (let row = 0; row < 4; row++) {
    const rowBtns = [];
    for (let col = 0; col < 3; col++) {
      const i = row * 3 + col;
      const cnt = monthlyCounts[i];
      const isCur = (year === currentYear && i === currentMonth);
      const label = isCur
        ? `${MONTH_EMOJI[i]} ${MONTHS_UZ[i]} (${cnt}) ◄`
        : `${MONTH_EMOJI[i]} ${MONTHS_UZ[i]} (${cnt})`;
      rowBtns.push({ text: label, callback_data: `stats_month:${year}:${i}` });
    }
    monthButtons.push(rowBtns);
  }

  const inline_keyboard = [
    [
      { text: `◀ ${year-1}`, callback_data: `stats_year:${year-1}` },
      { text: `${year} ✦`,   callback_data: `stats_year:${year}`   },
      { text: `${year+1} ▶`, callback_data: `stats_year:${year+1}` }
    ],
    ...monthButtons
  ];

  await bot.editMessageText(text, {
    chat_id: TG_CHAT, message_id: msgId,
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard }
  });
}


// ── Oy detali ──────────────────────────────────────────
const EVENT_LABELS = {
  wedding:  "💍 To'y",
  birthday: "🎂 Tug'ilgan kun",
  yubiley:  "🌟 Yubiley",
  haj:      "🕌 Haj To'yi",
  banket:   "🥂 Banket"
};

async function sendMonthDetail(year, monthIndex, msgId) {
  const monthStr = String(monthIndex + 1).padStart(2, '0');
  const prefix   = `${year}-${monthStr}`;

  const bookings = await bookingsCol.find({
    date: { $regex: `^${prefix}` },
    status: { $ne: 'rejected' }
  }).sort({ date: 1, slot: 1 }).toArray();

  const monthName  = MONTHS_UZ[monthIndex];
  const monthEmoji = MONTH_EMOJI[monthIndex];

  let text = `${monthEmoji} <b>${monthName} ${year}</b>
`;

  if (bookings.length === 0) {
    text += `
<i>Bu oyda hali bron yo'q.</i>`;
  } else {
    text += `<i>${bookings.length} ta bron</i>
`;
    text += `━━━━━━━━━━━━━━━━━━━━

`;

    // Group by date
    const byDate = {};
    bookings.forEach(b => {
      if (!byDate[b.date]) byDate[b.date] = [];
      byDate[b.date].push(b);
    });

    Object.keys(byDate).sort().forEach(date => {
      const day = parseInt(date.split('-')[2]);
      const dayBookings = byDate[date];

      // Day header
      text += `📅 <b>${day}-${monthName}</b>
`;

      dayBookings.forEach(b => {
        const slotIcon  = b.slot === 'morning' ? '☀️' : '🌙';
        const slotTime  = b.slot === 'morning' ? '09:00–15:00' : '17:00–23:00';
        const eventName = EVENT_LABELS[b.event] || b.event;
        const statusIcon = b.status === 'confirmed' ? '✅' : '⏳';

        text += `  ${slotIcon} <code>${slotTime}</code>
`;
        text += `  ${statusIcon} ${eventName}
`;
        text += `  👤 ${b.name} · 📞 ${b.phone}
`;
        if (b.guests && b.guests !== '—') {
          text += `  👥 ${b.guests} mehmon
`;
        }
        text += `
`;
      });

      text += `─────────────────────
`;
    });
  }

  const inline_keyboard = [
    [{ text: '◀ Ortga — Statistika', callback_data: `stats_year:${year}` }]
  ];

  await bot.editMessageText(text, {
    chat_id: TG_CHAT,
    message_id: msgId,
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard }
  });
}

// Inline tugma callback
bot.on('callback_query', async (query) => {
  if (String(query.message.chat.id) !== String(TG_CHAT)) return;

  const [action, param] = query.data.split(':');

  // Stats year navigation
  if (action === 'stats_year') {
    const year = parseInt(param);
    await bot.answerCallbackQuery(query.id);
    await sendYearStatsByYear(year, query.message.message_id);
    return;
  }

  // Stats month detail
  if (action === 'stats_month') {
    const [yearStr, monthStr] = query.data.split(':').slice(1);
    const year       = parseInt(yearStr);
    const monthIndex = parseInt(monthStr);
    await bot.answerCallbackQuery(query.id);
    await sendMonthDetail(year, monthIndex, query.message.message_id);
    return;
  }

  if (action === 'done') { bot.answerCallbackQuery(query.id); return; }

  const bookingId = param;

  const booking = await bookingsCol.findOne({ id: parseInt(bookingId) });
  if (!booking) {
    bot.answerCallbackQuery(query.id, { text: '⚠️ Bron topilmadi!' });
    return;
  }

  if (action === 'confirm') {
    await bookingsCol.updateOne({ id: parseInt(bookingId) }, { $set: { status: 'confirmed' } });
    bot.answerCallbackQuery(query.id, { text: '✅ Tasdiqlandi!' });
    bot.editMessageReplyMarkup(
      { inline_keyboard: [[{ text: '✅ TASDIQLANGAN', callback_data: 'done' }]] },
      { chat_id: TG_CHAT, message_id: query.message.message_id }
    );
    bot.sendMessage(TG_CHAT,
      `✅ <b>${booking.name}</b> — <b>${booking.date}</b> (${booking.slot === 'morning' ? '☀️ Ertalab' : '🌙 Kechqurun'}) bron <b>tasdiqlandi!</b>`,
      { parse_mode: 'HTML' }
    );
  }

  if (action === 'reject') {
    await bookingsCol.updateOne({ id: parseInt(bookingId) }, { $set: { status: 'rejected' } });
    bot.answerCallbackQuery(query.id, { text: '❌ Rad etildi!' });
    bot.editMessageReplyMarkup(
      { inline_keyboard: [[{ text: '❌ RAD ETILDI', callback_data: 'done' }]] },
      { chat_id: TG_CHAT, message_id: query.message.message_id }
    );
    bot.sendMessage(TG_CHAT,
      `❌ <b>${booking.name}</b> — <b>${booking.date}</b> bron <b>rad etildi.</b>`,
      { parse_mode: 'HTML' }
    );
  }
});

// ── API Routes ──────────────────────────────────────────

// Yangi bron (saytdan)
app.post('/api/booking', async (req, res) => {
  const { name, phone, event, slot, date, guests, note } = req.body;

  if (!name || !phone || !event || !slot || !date) {
    return res.status(400).json({ error: 'Majburiy maydonlar to\'ldirilmagan' });
  }

  // Slot band emasligini tekshirish
  const conflict = await bookingsCol.findOne({
    date, slot, status: { $ne: 'rejected' }
  });
  if (conflict) {
    return res.status(409).json({ error: 'Bu vaqt allaqachon band!' });
  }

  const booking = {
    id: Date.now(),
    name, phone, event, slot, date,
    guests: guests || '—',
    note:   note   || '—',
    status: 'pending',
    submitted: new Date().toISOString()
  };

  await bookingsCol.insertOne(booking);

  const eventLabels = {
    wedding:  "💍 To'y / Wedding",
    birthday: "🎂 Tug'ilgan kun",
    yubiley:  "🌟 Yubiley",
    haj:      "🕌 Haj To'yi",
    banket:   "🥂 Banket"
  };
  const slotLabel = slot === 'morning' ? '☀️ Ertalab (09:00–15:00)' : '🌙 Kechqurun (17:00–23:00)';

  const tgText =
`🎉 <b>YANGI BRON SO'ROVI</b>
🏛 Ofarin To'yxonasi

👤 <b>Ism:</b> ${name}
📞 <b>Telefon:</b> ${phone}
📅 <b>Sana:</b> ${date}
🕐 <b>Vaqt:</b> ${slotLabel}
🎊 <b>Tadbir:</b> ${eventLabels[event] || event}
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

// Kontakt xabari
app.post('/api/contact', async (req, res) => {
  const { name, phone, message } = req.body;
  if (!name || !phone || !message) {
    return res.status(400).json({ error: 'Barcha maydonlar to\'ldirilishi shart' });
  }

  await contactsCol.insertOne({ name, phone, message, date: new Date().toISOString() });

  const tgText =
`💬 <b>YANGI XABAR</b>
🏛 Ofarin To'yxonasi

👤 <b>Ism:</b> ${name}
📞 <b>Telefon:</b> ${phone}
📝 <b>Xabar:</b> ${message}`;

  await bot.sendMessage(TG_CHAT, tgText, { parse_mode: 'HTML' });
  res.json({ success: true });
});

// Barcha bronlar (Mini App + admin uchun)
app.get('/api/bookings', async (req, res) => {
  const bookings = await bookingsCol.find({}, { projection: { _id: 0 } }).toArray();
  res.json(bookings);
});

// Bronni yangilash (admin dashboard uchun)
app.post('/api/booking/:id/status', async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  const result = await bookingsCol.updateOne(
    { id: parseInt(id) },
    { $set: { status } }
  );
  if (result.matchedCount === 0) return res.status(404).json({ error: 'Topilmadi' });
  res.json({ success: true });
});

// Bronni o'chirish
app.delete('/api/booking/:id', async (req, res) => {
  const { id } = req.params;
  await bookingsCol.deleteOne({ id: parseInt(id) });
  res.json({ success: true });
});

// Mini App
app.get('/miniapp', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'miniapp.html'));
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', db: db ? 'connected' : 'disconnected' });
});

// ── Start ───────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅ Server ishlamoqda: http://localhost:${PORT}`);
});
connectDB();
