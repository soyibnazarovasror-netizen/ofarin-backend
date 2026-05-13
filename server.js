// ===========================
// OFARIN — server.js
// Express + Telegram Bot
// ===========================

require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');
const TelegramBot = require('node-telegram-bot-api');

const app  = express();
const PORT = process.env.PORT || 3000;

const TG_TOKEN   = process.env.TG_TOKEN;
const TG_CHAT    = process.env.TG_CHAT;
const MINIAPP_URL = process.env.MINIAPP_URL || `https://ofarin-backend-1.onrender.com/miniapp`;

// ── Middleware ──────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── In-memory storage (sodda, server restart bo'lsa tozalanadi)
// Production uchun Firebase yoki MongoDB qo'shish mumkin
let bookings = [];   // { id, name, phone, event, slot, date, guests, note, status, submitted }
let offlineBookings = []; // keyinchalik

// ── Telegram Bot ────────────────────────────────────────
const bot = new TelegramBot(TG_TOKEN, { polling: true });

// /start komandasi
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

// Menyu tugmalari
bot.on('message', (msg) => {
  if (String(msg.chat.id) !== String(TG_CHAT)) return;
  const text = msg.text;

  if (text === '📅 Online Bronlar') {
    bot.sendMessage(TG_CHAT,
      '📅 <b>Online bronlar kalendari</b>\nQuyidagi tugmani bosing:',
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [[
            {
              text: '🗓 Kalendarni ochish',
              web_app: { url: `${MINIAPP_URL}?section=online` }
            }
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
    const total     = bookings.length;
    const pending   = bookings.filter(b => b.status === 'pending').length;
    const confirmed = bookings.filter(b => b.status === 'confirmed').length;
    const rejected  = bookings.filter(b => b.status === 'rejected').length;

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

// Inline tugma callback (tasdiqlash / rad etish)
bot.on('callback_query', async (query) => {
  if (String(query.message.chat.id) !== String(TG_CHAT)) return;

  const [action, bookingId] = query.data.split(':');
  const booking = bookings.find(b => String(b.id) === String(bookingId));

  if (!booking) {
    bot.answerCallbackQuery(query.id, { text: '⚠️ Bron topilmadi!' });
    return;
  }

  if (action === 'confirm') {
    booking.status = 'confirmed';
    bot.answerCallbackQuery(query.id, { text: '✅ Tasdiqlandi!' });
    bot.editMessageReplyMarkup(
      { inline_keyboard: [[{ text: '✅ TASDIQLANGAN', callback_data: 'done' }]] },
      { chat_id: TG_CHAT, message_id: query.message.message_id }
    );
    // Tasdiqlash xabari
    bot.sendMessage(TG_CHAT,
      `✅ <b>${booking.name}</b> — <b>${booking.date}</b> (${booking.slot === 'morning' ? '☀️ Ertalab' : '🌙 Kechqurun'}) bron <b>tasdiqlandi!</b>`,
      { parse_mode: 'HTML' }
    );
  }

  if (action === 'reject') {
    booking.status = 'rejected';
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

// Yangi bron qabul qilish (saytdan keladi)
app.post('/api/booking', async (req, res) => {
  const { name, phone, event, slot, date, guests, note } = req.body;

  if (!name || !phone || !event || !slot || !date) {
    return res.status(400).json({ error: 'Majburiy maydonlar to\'ldirilmagan' });
  }

  // Shu kun uchun slot band emasligini tekshirish
  const conflict = bookings.find(
    b => b.date === date && b.slot === slot && b.status !== 'rejected'
  );
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
  bookings.push(booking);

  const eventLabels = {
    wedding:  "💍 To'y / Wedding",
    birthday: "🎂 Tug'ilgan kun",
    yubiley:  "🌟 Yubiley",
    haj:      "🕌 Haj To'yi",
    banket:   "🥂 Banket"
  };
  const slotLabel = slot === 'morning' ? '☀️ Ertalab (09:00–15:00)' : '🌙 Kechqurun (17:00–23:00)';

  // Telegram xabari
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

  const tgText =
`💬 <b>YANGI XABAR</b>
🏛 Ofarin To'yxonasi

👤 <b>Ism:</b> ${name}
📞 <b>Telefon:</b> ${phone}
📝 <b>Xabar:</b> ${message}`;

  await bot.sendMessage(TG_CHAT, tgText, { parse_mode: 'HTML' });
  res.json({ success: true });
});

// Barcha bronlarni olish (Mini App uchun)
app.get('/api/bookings', (req, res) => {
  res.json(bookings);
});

// Bronni yangilash (admin dashboard uchun)
app.post('/api/booking/:id/status', (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  const booking = bookings.find(b => String(b.id) === String(id));
  if (!booking) return res.status(404).json({ error: 'Topilmadi' });
  booking.status = status;
  res.json({ success: true, booking });
});

// Mini App sahifasini yuborish
app.get('/miniapp', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'miniapp.html'));
});

// ── Server ishga tushirish ──────────────────────────────
app.listen(PORT, () => {
  console.log(`✅ Ofarin server ishlamoqda: http://localhost:${PORT}`);
  console.log(`📅 Mini App: http://localhost:${PORT}/miniapp`);
});
