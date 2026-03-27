const puppeteer = require("puppeteer");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const FormData = require("form-data");

// ─────────────────────────────────────────────
// CONFIG (METS TES VALEURS OU VARIABLES ENV)
// ─────────────────────────────────────────────
const WEBHOOK_URL = process.env.WEBHOOK_URL || "https://discord.com/api/webhooks/1484555324810723398/5C_TiGKAdL0HlR6bfHOHPRyhVANsTuxvAplD0F3yDps8HTm-qd358cVP7tR5dCabOVIN";

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || "8770013859:AAE3KknyIsHwujpL_BgI3RAeWlDHbtEzrsU";
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "@Erdezz";

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;"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" 
const GIST_ID = process.env.GIST_ID;

const TELEGRAM_CHANNELS = [
  "hacoolinksydeuxx",
  "linkscrewfinds",
  "mkfashionfinds"
];

const LOCAL_CACHE_FILE = path.join(__dirname, "sent.json");
const QUEUE_FILE = path.join(__dirname, "queue.json");

const BATCH_SIZE = 5;
const INTERVAL_MS = 5 * 60 * 1000;
let INITIAL_SCAN = true;

// ─────────────────────────────────────────────
// CACHE
// ─────────────────────────────────────────────
async function loadSentLinks() {
  if (GITHUB_TOKEN && GIST_ID) {
    try {
      const res = await axios.get(`https://api.github.com/gists/${GIST_ID}`, {
        headers: { Authorization: `token ${GITHUB_TOKEN}` }
      });
      return new Set(JSON.parse(Object.values(res.data.files)[0].content));
    } catch {
      console.log("⚠️ Gist erreur → local");
    }
  }

  if (fs.existsSync(LOCAL_CACHE_FILE)) {
    return new Set(JSON.parse(fs.readFileSync(LOCAL_CACHE_FILE)));
  }

  return new Set();
}

async function saveSentLinks(sent) {
  const data = [...sent].slice(-300);

  if (GITHUB_TOKEN && GIST_ID) {
    try {
      await axios.patch(
        `https://api.github.com/gists/${GIST_ID}`,
        { files: { "sent.json": { content: JSON.stringify(data) } } },
        { headers: { Authorization: `token ${GITHUB_TOKEN}` } }
      );
    } catch {}
  }

  fs.writeFileSync(LOCAL_CACHE_FILE, JSON.stringify(data, null, 2));
}

// ─────────────────────────────────────────────
// QUEUE
// ─────────────────────────────────────────────
function loadQueue() {
  if (fs.existsSync(QUEUE_FILE)) {
    return JSON.parse(fs.readFileSync(QUEUE_FILE));
  }
  return [];
}

function saveQueue(queue) {
  fs.writeFileSync(QUEUE_FILE, JSON.stringify(queue, null, 2));
}

// ─────────────────────────────────────────────
// SCRAPING TELEGRAM
// ─────────────────────────────────────────────
async function scrapePage(page, channel, beforeId = null) {
  const url = beforeId
    ? `https://t.me/s/${channel}?before=${beforeId}`
    : `https://t.me/s/${channel}`;

  await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
  await new Promise(r => setTimeout(r, 2000));

  return await page.evaluate(() => {
    const results = [];
    let oldestId = null;

    document.querySelectorAll(".tgme_widget_message").forEach(msg => {
      const dateLink = msg.querySelector(".tgme_widget_message_date a");
      const id = dateLink?.href?.split("/").pop();
      if (id && (!oldestId || id < oldestId)) oldestId = id;

      const dealLink = msg.querySelector('a[href*="c.onlyaff.app"]')?.href;
      if (!dealLink) return;

      // IMAGE FIX
      let image = null;

      const photo = msg.querySelector(".tgme_widget_message_photo_wrap");
      if (photo) {
        const match = photo.style.backgroundImage.match(/url\(["']?(.*?)["']?\)/);
        if (match && match[1] && !match[1].startsWith("blob:")) {
          image = match[1];
        }
      }

      if (!image) {
        const img = msg.querySelector("img");
        if (img && img.src && !img.src.startsWith("blob:")) {
          image = img.src;
        }
      }

      const text =
        msg.querySelector(".tgme_widget_message_text")?.innerText || "";

      const lines = text.split("\n").filter(Boolean);

      results.push({
        title: lines[0] || "Produit",
        price: lines.find(l => l.includes("€")) || "Voir prix",
        description: lines.slice(1, 3).join(" • "),
        link: dealLink,
        image,
        date: msg.querySelector("time")?.getAttribute("datetime")
      });
    });

    return { results, oldestId };
  });
}

async function scrapeAll() {
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox"]
  });

  const page = await browser.newPage();
  let all = [];

  const maxPages = INITIAL_SCAN ? 10 : 3;

  for (const chan of TELEGRAM_CHANNELS) {
    console.log("📡", chan);

    let before = null;

    for (let i = 0; i < maxPages; i++) {
      const { results, oldestId } = await scrapePage(page, chan, before);

      if (!results.length || !oldestId) break;

      all.push(...results);
      before = oldestId;
    }
  }

  await browser.close();
  INITIAL_SCAN = false;

  return all;
}

// ─────────────────────────────────────────────
// DISCORD
// ─────────────────────────────────────────────
async function sendDiscord(product) {
  const image =
    product.image && !product.image.includes("blob")
      ? product.image
      : "https://placehold.co/600x400?text=Deal";

  await axios.post(WEBHOOK_URL, {
    embeds: [
      {
        title: product.title,
        url: product.link,
        description: `💰 **${product.price}**\n\n${product.description}`,
        image: { url: image },
        color: 0x00ff00,
        timestamp: product.date
          ? new Date(product.date).toISOString()
          : new Date().toISOString()
      }
    ]
  });
}

// ─────────────────────────────────────────────
// TELEGRAM (ULTRA FIABLE)
// ─────────────────────────────────────────────
async function sendTelegram(product) {
  const caption =
    `🛍️ ${product.title}\n` +
    `💰 ${product.price}\n\n` +
    `🔗 ${product.link}`;

  try {
    if (product.image && !product.image.includes("blob")) {
      // Téléchargement + upload (FIABLE)
      const res = await axios.get(product.image, { responseType: "arraybuffer" });

      const form = new FormData();
      form.append("chat_id", TELEGRAM_CHAT_ID);
      form.append("caption", caption);
      form.append("photo", res.data, "image.jpg");

      await axios.post(
        `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendPhoto`,
        form,
        { headers: form.getHeaders() }
      );
    } else {
      throw new Error("No image");
    }

    console.log("✈️ Telegram OK:", product.title);

  } catch {
    // fallback texte
    await axios.post(
      `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`,
      {
        chat_id: TELEGRAM_CHAT_ID,
        text: caption
      }
    );

    console.log("⚠️ Telegram fallback texte");
  }
}

// ─────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────
async function main() {
  console.log("\n--- 🚀 CYCLE ---");

  const sent = await loadSentLinks();
  let queue = loadQueue();

  const scraped = await scrapeAll();

  const fresh = scraped.filter(
    p =>
      !sent.has(p.link) &&
      !queue.some(q => q.link === p.link)
  );

  if (fresh.length) {
    console.log("✨ nouveaux :", fresh.length);
    queue.push(...fresh);
  }

  const toSend = queue.splice(0, BATCH_SIZE);

  for (const p of toSend) {
    try {
      await sendDiscord(p);
      await sendTelegram(p);

      sent.add(p.link);
      console.log("✅", p.title);

    } catch {
      console.log("❌ erreur envoi");
    }

    await new Promise(r => setTimeout(r, 2000));
  }

  saveQueue(queue);
  await saveSentLinks(sent);

  console.log("--- FIN ---");
}

// ─────────────────────────────────────────────
main();
setInterval(main, INTERVAL_MS);
