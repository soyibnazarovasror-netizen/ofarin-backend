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
    const total     = await bookingsCol.countDocuments();
    const pending   = await bookingsCol.countDocuments({ status: 'pending' });
    const confirmed = await bookingsCol.countDocuments({ status: 'confirmed' });
    const rejected  = await bookingsCol.countDocuments({ status: 'rejected' });

    bot.sendMessage(TG_CHAT,
      `📊 <b>Statistika</b>\n\n` +
      `📝 Jami: <b>${total}</b>\n` +
      `⏳ Kutilmoqda: <b>${pending}</b>\n` +
      `✅ Tasdiqlangan: <b>${confirmed}</b>\n` +
      `❌ Rad etilgan: <b>${rejected}</b>`,
      { parse_mode: 'HTML' }
    );
  }
});

// Inline tugma callback
bot.on('callback_query', async (query) => {
  if (String(query.message.chat.id) !== String(TG_CHAT)) return;

  const [action, bookingId] = query.data.split(':');
  if (action === 'done') { bot.answerCallbackQuery(query.id); return; }

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
