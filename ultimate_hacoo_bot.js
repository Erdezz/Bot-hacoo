const puppeteer = require("puppeteer");
const axios = require("axios");
const fs = require("fs");
const path = require("path");

// ─────────────────────────────────────────────
// CONFIGURATION
// ─────────────────────────────────────────────
const WEBHOOK_URL = process.env.WEBHOOK_URL || "https://discord.com/api/webhooks/1484555324810723398/5C_TiGKAdL0HlR6bfHOHPRyhVANsTuxvAplD0F3yDps8HTm-qd358cVP7tR5dCabOVIN";
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;"username/Erdezz"
const GIST_ID = process.env.GIST_ID;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;"8623248061:AAH6rBf57jJNftcIOkmp2WruA67zCyC3Zj8"
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID; 

const TELEGRAM_CHANNELS = [
  "hacoolinksydeuxx",
  "linkscrewfinds",
  "mkfashionfinds",
];

const LOCAL_CACHE_FILE = path.join(__dirname, "sent_links_cache.json");
const QUEUE_FILE = path.join(__dirname, "queue.json");

const BATCH_SIZE = 5;
const INTERVAL_MS = 5 * 60 * 1000;
let INITIAL_SCAN = true;

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
    if (fs.existsSync(LOCAL_CACHE_FILE)) {
      return new Set(JSON.parse(fs.readFileSync(LOCAL_CACHE_FILE, "utf-8")));
    }
  } catch {}
  return new Set();
}

async function saveSentLinks(sentLinks) {
  const data = [...sentLinks];
  if (GITHUB_TOKEN && GIST_ID) {
    try {
      await axios.patch(`https://api.github.com/gists/${GIST_ID}`,
        { files: { "sent_links.json": { content: JSON.stringify(data, null, 2) } } },
        { headers: { Authorization: `token ${GITHUB_TOKEN}` } }
      );
    } catch {}
  }
  fs.writeFileSync(LOCAL_CACHE_FILE, JSON.stringify(data, null, 2), "utf-8");
}

function loadQueue() {
  try {
    if (fs.existsSync(QUEUE_FILE)) return JSON.parse(fs.readFileSync(QUEUE_FILE, "utf-8"));
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
  const url = beforeId ? `https://t.me/s/${channelName}?before=${beforeId}` : `https://t.me/s/${channelName}`;
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
          const id = parseInt(msgLink.getAttribute("href")?.split('/').pop());
          if (!oldestId || id < oldestId) oldestId = id;
        }

        const linkEl = msg.querySelector('a[href*="c.onlyaff.app"]');
        if (!linkEl) return;

        const imgEl = msg.querySelector(".tgme_widget_message_photo_wrap") || msg.querySelector('a[style*="background-image"]');
        let image = imgEl?.getAttribute("style")?.match(/url\(['"]?([^'"]+)['"]?\)/)?.[1] || null;

        const textEl = msg.querySelector(".tgme_widget_message_text");
        const lines = textEl ? textEl.innerText.split("\n").map(l => l.trim()).filter(Boolean) : [];

        products.push({
          title: lines[0] || "Produit",
          price: lines.find(l => l.includes("€") || l.includes("$")) || "Prix voir site",
          description: lines.slice(1, 4).join(" • "),
          image,
          link: linkEl.href,
          date: msg.querySelector("time")?.getAttribute("datetime")
        });
      });
      return { products, oldestId };
    });
  } catch { return { products: [], oldestId: null }; }
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
// ENVOI TELEGRAM
// ─────────────────────────────────────────────
async function sendToTelegram(product) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
  try {
    const caption = `*${product.title}*\n${product.description ? `_${product.description}_\n` : ""}💰 ${product.price}\n🔗 ${product.link}`;

    if (product.image) {
      await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`, {
        chat_id: TELEGRAM_CHAT_ID,
        photo: product.image,
        caption: caption,
        parse_mode: "Markdown"
      });
    } else {
      await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
        chat_id: TELEGRAM_CHAT_ID,
        text: caption,
        parse_mode: "Markdown"
      });
    }
    console.log(`📨 Telegram : ${product.title}`);
  } catch (e) {
    console.error("❌ Erreur Telegram :", e.response?.data || e.message);
  }
}

// ─────────────────────────────────────────────
// LOGIQUE PRINCIPALE
// ─────────────────────────────────────────────
async function main() {
  console.log("\n--- DEBUT DU CYCLE ---");
  const sentLinks = await loadSentLinks();
  let queue = loadQueue();

  const newItems = await scrapeAllChannels();

  const uniqueNewItems = newItems.filter(item =>
    !sentLinks.has(item.link) && !queue.some(q => q.link === item.link)
  );

  if (uniqueNewItems.length > 0) {
    console.log(`✨ ${uniqueNewItems.length} nouveaux produits ajoutés.`);
    queue.push(...uniqueNewItems);
  }

  queue = shuffle(queue);

  const toSend = queue.splice(0, BATCH_SIZE);
  console.log(`📤 Envoi de ${toSend.length} produits. (Reste en file: ${queue.length})`);

  for (const product of toSend) {
    try {
      await axios.post(WEBHOOK_URL, {
        embeds: [{
          title: product.title,
          url: product.link,
          description: `💰 **${product.price}**\n\n${product.description}`,
          image: product.image ? { url: product.image } : null,
          color: 0x00ff00,
          footer: { text: "Mix Aléatoire" },
          timestamp: product.date ? new Date(product.date).toISOString() : new Date().toISOString()
        }]
      });
      sentLinks.add(product.link);
      console.log(`✅ Discord : ${product.title}`);
    } catch (e) {
      console.error("❌ Erreur Discord");
    }

    // ✅ Envoi Telegram en même temps
    await sendToTelegram(product);

    await new Promise(r => setTimeout(r, 2000));
  }

  saveQueue(queue);
  await saveSentLinks(sentLinks);
  console.log("--- FIN DU CYCLE (Prochain dans 5min) ---");
}

main();
setInterval(main, INTERVAL_MS);
```

## Dans Railway → Variables ajoute juste les 2 nouvelles :
```
TELEGRAM_BOT_TOKEN = ton_token_botfather
TELEGRAM_CHAT_ID   = ton_chat_id
