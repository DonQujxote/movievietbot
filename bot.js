const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");
const fs = require("fs");

const BOT_TOKEN = process.env.BOT_TOKEN;

if (!BOT_TOKEN || BOT_TOKEN === "DAN_TOKEN_CUA_BAN") {
  console.log("❌ Bạn chưa dán BOT TOKEN");
  process.exit();
}

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

console.log("🚀 MOVIE BOT PRO MAX đang chạy...");

const EPISODES_PER_PAGE = 10;
const movieCache = new Map();
const HISTORY_FILE = "./watch_history.json";

let watchHistory = {};
if (fs.existsSync(HISTORY_FILE)) {
  try {
    watchHistory = JSON.parse(fs.readFileSync(HISTORY_FILE));
  } catch {
    watchHistory = {};
  }
}

function saveHistory() {
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(watchHistory, null, 2));
}

function normalize(text) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

// ================= START =================
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    `🎬 <b>MOVIE BOT PRO MAX</b>

🔎 /s tên phim
📌 /continue`,
    { parse_mode: "HTML" }
  );
});

// ================= SEARCH =================
bot.onText(/\/s (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const keyword = match[1];

  try {
    const res = await axios.get(
      `https://ophim1.com/v1/api/tim-kiem?keyword=${encodeURIComponent(keyword)}`
    );

    let movies = res.data?.data?.items || [];

    movies = movies.filter((m) =>
      normalize(m.name).includes(normalize(keyword))
    );

    if (!movies.length)
      return bot.sendMessage(chatId, "❌ Không tìm thấy phim.");

    const keyboard = movies.slice(0, 6).map((m) => [
      { text: m.name, callback_data: `detail|${m.slug}` },
    ]);

    bot.sendMessage(chatId, `🎬 Kết quả cho: <b>${keyword}</b>`, {
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: keyboard },
    });
  } catch {
    bot.sendMessage(chatId, "⚠️ Lỗi tìm phim.");
  }
});

// ================= CALLBACK =================
bot.on("callback_query", async (query) => {
  const data = query.data;
  const chatId = query.message.chat.id;
  const messageId = query.message.message_id;
  const userId = query.from.id;

  try {
    // ===== CHI TIẾT PHIM =====
    if (data.startsWith("detail|")) {
      const slug = data.split("|")[1];

      const res = await axios.get(`https://ophim1.com/phim/${slug}`);
      const movieData = res.data;
      movieCache.set(slug, movieData);

      const movie = movieData.movie;
      const servers = movieData.episodes || [];

      if (!servers.length)
        return bot.sendMessage(chatId, "⚠️ Phim chưa có tập.");

      const poster = movie.poster_url?.startsWith("http")
        ? movie.poster_url
        : `https://ophim1.com/${movie.poster_url}`;

      // Tạo nút chọn Vietsub / Thuyết Minh
      const serverButtons = servers.map((s, index) => [
        {
          text: `🎧 ${s.server_name}`,
          callback_data: `server|${slug}|${index}`,
        },
      ]);

      await bot.sendPhoto(chatId, poster, {
        caption: `🎬 <b>${movie.name}</b>\n\nChọn phiên bản:`,
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: serverButtons },
      });

      await bot.answerCallbackQuery(query.id);
    }

    // ===== CHỌN SERVER =====
    else if (data.startsWith("server|")) {
      const [, slug, serverIndex] = data.split("|");

      const movieData = movieCache.get(slug);
      const server = movieData.episodes[serverIndex];
      const episodes = server.server_data;

      const keyboard = buildKeyboard(
        slug,
        serverIndex,
        0,
        episodes.length,
        userId
      );

      await bot.editMessageReplyMarkup(
        { inline_keyboard: keyboard },
        { chat_id: chatId, message_id: messageId }
      );

      await bot.answerCallbackQuery(query.id);
    }

    // ===== PHÂN TRANG =====
    else if (data.startsWith("page|")) {
      const [, slug, serverIndex, page] = data.split("|");

      const movieData = movieCache.get(slug);
      const episodes =
        movieData.episodes[serverIndex].server_data;

      const keyboard = buildKeyboard(
        slug,
        serverIndex,
        parseInt(page),
        episodes.length,
        userId
      );

      await bot.editMessageReplyMarkup(
        { inline_keyboard: keyboard },
        { chat_id: chatId, message_id: messageId }
      );

      await bot.answerCallbackQuery(query.id);
    }

    // ===== PLAY =====
    else if (data.startsWith("play|")) {
      const [, slug, serverIndex, epIndex] = data.split("|");

      const movieData = movieCache.get(slug);
      const episode =
        movieData.episodes[serverIndex].server_data[epIndex];

      watchHistory[userId] = {
        slug,
        serverIndex,
        episode: parseInt(epIndex),
      };
      saveHistory();

      await bot.sendMessage(
        chatId,
        `🎬 Bạn đang xem tập ${parseInt(epIndex) + 1}`,
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: "▶️ XEM NGAY", url: episode.link_m3u8 }],
            ],
          },
        }
      );

      await bot.answerCallbackQuery(query.id);
    }
  } catch (err) {
    console.log("ERROR:", err.message);
    bot.answerCallbackQuery(query.id, {
      text: "❌ Lỗi xử lý.",
      show_alert: true,
    });
  }
});

// ================= BUILD KEYBOARD =================
function buildKeyboard(slug, serverIndex, page, total, userId) {
  const start = page * EPISODES_PER_PAGE;
  const end = Math.min(start + EPISODES_PER_PAGE, total);

  const keyboard = [];

  for (let i = start; i < end; i++) {
    keyboard.push([
      {
        text: `▶️ Tập ${i + 1}`,
        callback_data: `play|${slug}|${serverIndex}|${i}`,
      },
    ]);
  }

  const nav = [];

  if (page > 0)
    nav.push({
      text: "⬅ Trang trước",
      callback_data: `page|${slug}|${serverIndex}|${page - 1}`,
    });

  if (end < total)
    nav.push({
      text: "Trang sau ➡",
      callback_data: `page|${slug}|${serverIndex}|${page + 1}`,
    });

  if (nav.length) keyboard.push(nav);

  return keyboard;
}
