const puppeteer = require("puppeteer");
const axios = require("axios");
const fs = require("fs");
const path = require("path");

// ─────────────────────────────────────────────
// CONFIGURATION
// ─────────────────────────────────────────────
const WEBHOOK_URL        = process.env.WEBHOOK_URL || "https://discord.com/api/webhooks/1484555324810723398/5C_TiGKAdL0HlR6bfHOHPRyhVANsTuxvAplD0F3yDps8HTm-qd358cVP7tR5dCabOVIN";
const GITHUB_TOKEN       = process.env.GITHUB_TOKEN;
const GIST_ID            = process.env.GIST_ID;

// 🤖 Telegram Bot
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "8770013859:AAE3KknyIsHwujpL_BgI3RAeWlDHbtEzrsU";
const TELEGRAM_CHAT_ID   = process.env.TELEGRAM_CHAT_ID   || "-1003725676174"; // ex: "-1001234567890"

const TELEGRAM_CHANNELS = [
  "hacoolinksydeuxx",
  "linkscrewfinds",
  "mkfashionfinds",
  "TON_4EME_CANAL",
];

const LOCAL_CACHE_FILE = path.join(__dirname, "sent_links_cache.json");
const QUEUE_FILE       = path.join(__dirname, "queue.json");

const BATCH_SIZE   = 5;
const INTERVAL_MS  = 5 * 60 * 1000;
let INITIAL_SCAN   = true;

// ─────────────────────────────────────────────
// UTILITAIRES
// ─────────────────────────────────────────────
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Cache (Gist ou Local)
async function loadSentLinks() {
  if (GITHUB_TOKEN && GIST_ID) {
    try {
      const res = await axios.get(`https://api.github.com/gists/${GIST_ID}`, {
        headers: { Authorization: `token ${GITHUB_TOKEN}` },
      });
      const content = Object.values(res.data.files)[0].content;
      return new Set(JSON.parse(content));
    } catch { console.warn("⚠️ Fallback cache local"); }
  }
  try {
    if (fs.existsSync(LOCAL_CACHE_FILE))
      return new Set(JSON.parse(fs.readFileSync(LOCAL_CACHE_FILE, "utf-8")));
  } catch {}
  return new Set();
}

async function saveSentLinks(sentLinks) {
  const data = [...sentLinks];
  if (GITHUB_TOKEN && GIST_ID) {
    try {
      await axios.patch(
        `https://api.github.com/gists/${GIST_ID}`,
        { files: { "sent_links.json": { content: JSON.stringify(data, null, 2) } } },
        { headers: { Authorization: `token ${GITHUB_TOKEN}` } }
      );
    } catch {}
  }
  fs.writeFileSync(LOCAL_CACHE_FILE, JSON.stringify(data, null, 2), "utf-8");
}

// Queue
function loadQueue() {
  try {
    if (fs.existsSync(QUEUE_FILE))
      return JSON.parse(fs.readFileSync(QUEUE_FILE, "utf-8"));
  } catch {}
  return [];
}

function saveQueue(queue) {
  fs.writeFileSync(QUEUE_FILE, JSON.stringify(queue, null, 2), "utf-8");
}

// ─────────────────────────────────────────────
// SCRAPING
// ─────────────────────────────────────────────
async function scrapePage(page, channelName, beforeId = null) {
  const url = beforeId
    ? `https://t.me/s/${channelName}?before=${beforeId}`
    : `https://t.me/s/${channelName}`;
  try {
    await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
    await new Promise(r => setTimeout(r, 2000));
    return await page.evaluate(() => {
      const messages = document.querySelectorAll(".tgme_widget_message");
      const products = [];
      let oldestId = null;

      messages.forEach(msg => {
        const msgLink = msg.querySelector(".tgme_widget_message_date");
        if (msgLink) {
          const id = parseInt(msgLink.getAttribute("href")?.split("/").pop());
          if (!oldestId || id < oldestId) oldestId = id;
        }

        const linkEl = msg.querySelector('a[href*="c.onlyaff.app"]');
        if (!linkEl) return;

        const imgEl =
          msg.querySelector(".tgme_widget_message_photo_wrap") ||
          msg.querySelector('a[style*="background-image"]');
        const image =
          imgEl?.getAttribute("style")?.match(/url\(['"]?([^'"]+)['"]?\)/)?.[1] || null;

        const textEl = msg.querySelector(".tgme_widget_message_text");
        const lines = textEl
          ? textEl.innerText.split("\n").map(l => l.trim()).filter(Boolean)
          : [];

        products.push({
          title: lines[0] || "Produit",
          price: lines.find(l => l.includes("€") || l.includes("$")) || "Prix voir site",
          description: lines.slice(1, 4).join(" • "),
          image,
          link: linkEl.href,
          date: msg.querySelector("time")?.getAttribute("datetime"),
        });
      });
      return { products, oldestId };
    });
  } catch {
    return { products: [], oldestId: null };
  }
}

async function scrapeAllChannels() {
  const browser = await puppeteer.launch({ headless: "new", args: ["--no-sandbox"] });
  const page = await browser.newPage();
  let allFound = [];
  const maxPages = INITIAL_SCAN ? 15 : 3;

  for (const channel of TELEGRAM_CHANNELS) {
    console.log(`📡 Scan @${channel}...`);
    let beforeId = null;
    for (let i = 0; i < maxPages; i++) {
      const { products, oldestId } = await scrapePage(page, channel, beforeId);
      if (!products.length || !oldestId) break;
      allFound.push(...products);
      beforeId = oldestId;
    }
  }
  await browser.close();
  INITIAL_SCAN = false;
  return allFound;
}

// ─────────────────────────────────────────────
// ENVOI DISCORD
// ─────────────────────────────────────────────
async function sendToDiscord(product) {
  await axios.post(WEBHOOK_URL, {
    embeds: [{
      title: product.title,
      url: product.link,
      description: `💰 **${product.price}**\n\n${product.description}`,
      image: product.image ? { url: product.image } : null,
      color: 0x00ff00,
      footer: { text: "Mix Aléatoire" },
      timestamp: product.date
        ? new Date(product.date).toISOString()
        : new Date().toISOString(),
    }],
  });
}

// ─────────────────────────────────────────────
// ENVOI TELEGRAM
// ─────────────────────────────────────────────
async function sendToTelegram(product) {
  const caption =
    `🛍️ *${escapeMarkdown(product.title)}*\n` +
    `💰 ${escapeMarkdown(product.price)}\n\n` +
    `${escapeMarkdown(product.description)}\n\n` +
    `[👉 Voir le produit](${product.link})`;

  const baseUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

  if (product.image) {
    // Envoi avec photo
    await axios.post(`${baseUrl}/sendPhoto`, {
      chat_id: TELEGRAM_CHAT_ID,
      photo: product.image,
      caption,
      parse_mode: "MarkdownV2",
    });
  } else {
    // Envoi texte seul
    await axios.post(`${baseUrl}/sendMessage`, {
      chat_id: TELEGRAM_CHAT_ID,
      text: caption,
      parse_mode: "MarkdownV2",
      disable_web_page_preview: false,
    });
  }
}

// Échappe les caractères spéciaux pour MarkdownV2
function escapeMarkdown(text = "") {
  return text.replace(/([_*[\]()~`>#+\-=|{}.!\\])/g, "\\$1");
}

// ─────────────────────────────────────────────
// LOGIQUE PRINCIPALE
// ─────────────────────────────────────────────
async function main() {
  console.log("\n--- DEBUT DU CYCLE ---");
  const sentLinks = await loadSentLinks();
  let queue = loadQueue();

  // 1. Scraper les nouveaux produits
  const newItems = await scrapeAllChannels();

  // 2. Filtrer doublons
  const uniqueNewItems = newItems.filter(
    item => !sentLinks.has(item.link) && !queue.some(q => q.link === item.link)
  );

  if (uniqueNewItems.length > 0) {
    console.log(`✨ ${uniqueNewItems.length} nouveaux produits ajoutés.`);
    queue.push(...uniqueNewItems);
  }

  // 3. Mélange aléatoire
  queue = shuffle(queue);

  // 4. Envoi du batch
  const toSend = queue.splice(0, BATCH_SIZE);
  console.log(`📤 Envoi de ${toSend.length} produits. (Reste en file: ${queue.length})`);

  for (const product of toSend) {
    // --- Discord ---
    try {
      await sendToDiscord(product);
      console.log(`✅ Discord: ${product.title}`);
    } catch (e) {
      console.error("❌ Erreur Discord:", e.response?.data || e.message);
    }
    await new Promise(r => setTimeout(r, 1000));

    // --- Telegram ---
    try {
      await sendToTelegram(product);
      console.log(`✅ Telegram: ${product.title}`);
    } catch (e) {
      console.error("❌ Erreur Telegram:", e.response?.data || e.message);
    }
    await new Promise(r => setTimeout(r, 2000));

    sentLinks.add(product.link);
  }

  // Sauvegarde
  saveQueue(queue);
  await saveSentLinks(sentLinks);
  console.log("--- FIN DU CYCLE (Prochain dans 5min) ---");
}

// Lancement
main();
setInterval(main, INTERVAL_MS);
