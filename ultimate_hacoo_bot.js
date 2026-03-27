const puppeteer = require("puppeteer");
const axios = require("axios");

// ─────────────────────────────────────────────
// CONFIGURATION
// ─────────────────────────────────────────────
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GIST_ID = process.env.GIST_ID;

// NOUVELLES VARIABLES TELEGRAM
const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TG_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const TELEGRAM_CHANNELS = [
  "hacoolinksydeuxx",
  "linkscrewfinds",
  "mkfashionfinds"
];

const BATCH_SIZE = 5;
const INTERVAL_MS = 5 * 60 * 1000;

// ─────────────────────────────────────────────
// FONCTIONS D'ENVOI
// ─────────────────────────────────────────────

async function sendToTelegram(product) {
  if (!TG_TOKEN || !TG_CHAT_ID) return;
  const url = `https://api.telegram.org/bot${TG_TOKEN}/sendPhoto`;
  const caption = `🛍️ **${product.title}**\n\n💰 **${product.price}**\n\n🔗 [CLIQUE ICI POUR VOIR](${product.link})`;
  
  try {
    await axios.post(url, {
      chat_id: TG_CHAT_ID,
      photo: product.image || "https://placehold.co/600x400?text=No+Image",
      caption: caption,
      parse_mode: "Markdown"
    });
    console.log(`✈️ Envoyé sur Telegram : ${product.title}`);
  } catch (e) {
    console.error("❌ Erreur Telegram :", e.response?.data?.description || e.message);
  }
}

// ─────────────────────────────────────────────
// LOGIQUE PRINCIPALE (Modifiée pour inclure Telegram)
// ─────────────────────────────────────────────

function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

async function loadData() {
  try {
    const res = await axios.get(`https://api.github.com/gists/${GIST_ID}`, {
      headers: { Authorization: `token ${GITHUB_TOKEN}` }
    });
    return JSON.parse(Object.values(res.data.files)[0].content);
  } catch { return { sent: [], queue: [] }; }
}

async function saveData(sent, queue) {
  try {
    await axios.patch(`https://api.github.com/gists/${GIST_ID}`, {
      files: { "data.json": { content: JSON.stringify({ sent, queue }) } }
    }, { headers: { Authorization: `token ${GITHUB_TOKEN}` } });
  } catch (err) { console.log("❌ Erreur Gist :", err.message); }
}

async function getProductsFromTelegram(channelName) {
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: "new",
      args: ["--no-sandbox", "--disable-setuid-sandbox"]
    });
    const page = await browser.newPage();
    await page.goto(`https://t.me/s/${channelName}`, { waitUntil: "networkidle2", timeout: 60000 });
    const products = await page.evaluate(() => {
      const results = [];
      document.querySelectorAll(".tgme_widget_message").forEach(msg => {
        const linkEl = msg.querySelector('a[href*="c.onlyaff.app"]');
        if (!linkEl) return;
        const imgEl = msg.querySelector(".tgme_widget_message_photo_wrap") || msg.querySelector('a[style*="background-image"]');
        let image = null;
        if (imgEl) {
          const style = imgEl.getAttribute("style") || "";
          const match = style.match(/url\(['"]?(https?[^'")\s]+)['"]?\)/);
          if (match) image = match[1];
        }
        const textEl = msg.querySelector(".tgme_widget_message_text");
        const lines = textEl ? textEl.innerText.trim().split("\n") : [];
        results.push({
          title: lines[0] || "Produit Hacoo",
          price: lines.find(l => l.includes("€") || l.includes("$")) || "Voir prix",
          description: lines.slice(1, 3).join(" ").substring(0, 200),
          image,
          link: linkEl.href
        });
      });
      return results;
    });
    await browser.close();
    return products;
  } catch (err) {
    if (browser) await browser.close();
    return [];
  }
}

async function main() {
  console.log("\n🔄 Début du cycle (Discord + Telegram)...");
  let data = await loadData();
  let sentSet = new Set(data.sent || []);
  let queue = data.queue || [];

  for (const channel of TELEGRAM_CHANNELS) {
    const found = await getProductsFromTelegram(channel);
    found.forEach(p => {
      if (!sentSet.has(p.link) && !queue.some(q => q.link === p.link)) {
        queue.push(p);
      }
    });
  }

  if (queue.length > 0) {
    queue = shuffle(queue);
    const toSend = queue.splice(0, BATCH_SIZE);

    for (const product of toSend) {
      // 1. ENVOI DISCORD
      try {
        await axios.post(WEBHOOK_URL, {
          embeds: [{
            title: product.title,
            url: product.link,
            description: `💰 **${product.price}**\n\n${product.description}`,
            image: product.image ? { url: product.image } : null,
            color: 0x00ff00
          }]
        });
        console.log(`✅ Envoyé Discord : ${product.title}`);
      } catch (e) { console.log("❌ Erreur Discord"); }

      // 2. ENVOI TELEGRAM
      await sendToTelegram(product);

      sentSet.add(product.link);
      await new Promise(r => setTimeout(r, 3000)); // Pause pour éviter le spam
    }
  }

  await saveData([...sentSet], queue);
  console.log(`⏳ Terminé. Prochain passage dans 5 min.`);
}

main();
setInterval(main, INTERVAL_MS);
