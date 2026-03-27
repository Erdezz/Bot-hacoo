const puppeteer = require("puppeteer");
const axios = require("axios");
const fs = require("fs");
const path = require("path");

// ─────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────
const WEBHOOK_URL = process.env.WEBHOOK_URL || "https://discord.com/api/webhooks/1484555324810723398/5C_TiGKAdL0HlR6bfHOHPRyhVANsTuxvAplD0F3yDps8HTm-qd358cVP7tR5dCabOVIN";
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GIST_ID = process.env.GIST_ID;

const TELEGRAM_CHANNELS = [
  "hacoolinksydeuxx",
  "linkscrewfinds",
  "mkfashionfinds",
];

const LOCAL_CACHE_FILE  = path.join(__dirname, "sent_links_cache.json");
const QUEUE_FILE        = path.join(__dirname, "queue.json");
const BATCH_SIZE        = 5;    // posts envoyés par cycle
const INTERVAL_MS       = 3 * 60 * 1000; // 3 minutes
const MAX_PAGES_PER_CHAN = 200;  // ~200 x ~20 msgs = ~4000 messages max par canal

// ─────────────────────────────────────────────
// UTILITAIRE — mélange tableau (Fisher-Yates)
// ─────────────────────────────────────────────
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ─────────────────────────────────────────────
// CACHE — liens déjà envoyés
// ─────────────────────────────────────────────
async function loadSentLinks() {
  if (GITHUB_TOKEN && GIST_ID) {
    try {
      const res = await axios.get(`https://api.github.com/gists/${GIST_ID}`, {
        headers: { Authorization: `token ${GITHUB_TOKEN}` },
      });
      const content = Object.values(res.data.files)[0].content;
      const links = JSON.parse(content);
      console.log(`✅ Gist : ${links.length} liens chargés`);
      return new Set(links);
    } catch (err) {
      console.warn("⚠️ Gist indisponible, fallback local :", err.message);
    }
  }
  try {
    if (fs.existsSync(LOCAL_CACHE_FILE)) {
      const links = JSON.parse(fs.readFileSync(LOCAL_CACHE_FILE, "utf-8"));
      console.log(`📁 Cache local : ${links.length} liens`);
      return new Set(links);
    }
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
      console.log("💾 Gist sauvegardé");
    } catch (err) {
      console.warn("⚠️ Erreur Gist :", err.message);
    }
  }
  try {
    fs.writeFileSync(LOCAL_CACHE_FILE, JSON.stringify(data, null, 2), "utf-8");
  } catch {}
}

// ─────────────────────────────────────────────
// QUEUE persistante
// ─────────────────────────────────────────────
function loadQueue() {
  try {
    if (fs.existsSync(QUEUE_FILE)) {
      const data = JSON.parse(fs.readFileSync(QUEUE_FILE, "utf-8"));
      console.log(`📬 Queue : ${data.length} produits en attente`);
      return data;
    }
  } catch {}
  return [];
}

function saveQueue(queue) {
  try {
    fs.writeFileSync(QUEUE_FILE, JSON.stringify(queue, null, 2), "utf-8");
  } catch {}
}

// ─────────────────────────────────────────────
// SCRAPING D'UNE PAGE TELEGRAM (via ?before=ID)
// ─────────────────────────────────────────────
async function scrapePage(page, channelName, beforeId = null) {
  const url = beforeId
    ? `https://t.me/s/${channelName}?before=${beforeId}`
    : `https://t.me/s/${channelName}`;

  try {
    await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
    await new Promise((r) => setTimeout(r, 1500));
  } catch (err) {
    console.warn(`   ⚠️ Timeout sur ${url}`);
    return { products: [], oldestId: null };
  }

  return await page.evaluate(() => {
    const messages = document.querySelectorAll(".tgme_widget_message");
    const products = [];
    let oldestId = null;

    messages.forEach((msg) => {
      // Récupérer l'ID du message pour la pagination
      const msgLink = msg.querySelector(".tgme_widget_message_date");
      if (msgLink) {
        const href = msgLink.getAttribute("href") || "";
        const match = href.match(/\/(\d+)$/);
        if (match) {
          const id = parseInt(match[1]);
          if (oldestId === null || id < oldestId) oldestId = id;
        }
      }

      const linkEl = msg.querySelector('a[href*="c.onlyaff.app"]');
      if (!linkEl) return;

      const link = linkEl.href;

      // Image
      const imgEl =
        msg.querySelector(".tgme_widget_message_photo_wrap") ||
        msg.querySelector('a[style*="background-image"]');
      let image = null;
      if (imgEl) {
        const style = imgEl.getAttribute("style") || "";
        const match = style.match(/url\(['"]?(https?[^'")\s]+)['"]?\)/);
        if (match) image = match[1];
      }

      // Texte
      const textEl = msg.querySelector(".tgme_widget_message_text");
      const fullText = textEl ? textEl.innerText.trim() : "";
      const lines = fullText.split("\n").map((l) => l.trim()).filter(Boolean);
      const title = lines[0] || "Produit tendance";
      const priceLine = lines.find((l) => l.includes("€") || l.includes("$"));
      const price = priceLine || "Prix inconnu";
      const desc = lines
        .slice(1)
        .filter((l) => l !== price && !l.includes("c.onlyaff.app"))
        .join(" • ");

      // Date
      const dateEl = msg.querySelector("time");
      const date = dateEl ? dateEl.getAttribute("datetime") : null;

      products.push({ title, price, description: desc, image, link, date });
    });

    return { products, oldestId };
  });
}

// ─────────────────────────────────────────────
// SCRAPING COMPLET D'UN CANAL (toutes les pages)
// ─────────────────────────────────────────────
async function scrapeFullChannel(channelName) {
  let browser;
  const allProducts = [];
  const seenLinks = new Set();

  try {
    browser = await puppeteer.launch({
      headless: "new",
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    const page = await browser.newPage();

    console.log(`   📡 Scraping @${channelName} (pagination complète)...`);

    let beforeId = null;
    let pageNum = 0;
    let stopScraping = false;

    while (!stopScraping && pageNum < MAX_PAGES_PER_CHAN) {
      pageNum++;
      const { products, oldestId } = await scrapePage(page, channelName, beforeId);

      if (!products || products.length === 0) {
        console.log(`   ✅ @${channelName} — fin de l'historique (page ${pageNum})`);
        break;
      }

      let newCount = 0;
      for (const p of products) {
        if (!seenLinks.has(p.link)) {
          seenLinks.add(p.link);
          allProducts.push(p);
          newCount++;
        }
      }

      console.log(`   📄 Page ${pageNum} — ${newCount} produits | total: ${allProducts.length}`);

      // Arrêter si on est arrivé avant 2024
      if (products.some((p) => p.date && new Date(p.date) < new Date("2024-01-01"))) {
        console.log(`   🛑 @${channelName} — messages antérieurs à 2024 détectés, arrêt`);
        stopScraping = true;
      }

      if (!oldestId) {
        console.log(`   ✅ @${channelName} — plus d'ID trouvé, fin`);
        break;
      }

      beforeId = oldestId;
      await new Promise((r) => setTimeout(r, 1000)); // pause entre pages
    }

  } catch (err) {
    console.error(`❌ Erreur scraping @${channelName} :`, err.message);
  } finally {
    if (browser) await browser.close();
  }

  return allProducts;
}

// ─────────────────────────────────────────────
// ENVOI DISCORD
// ─────────────────────────────────────────────
async function sendToDiscord(product) {
  try {
    const payload = {
      embeds: [{
        title: product.title.slice(0, 256),
        url: product.link,
        description:
          (product.description ? `*${product.description.slice(0, 300)}*\n\n` : "") +
          `💰 **${product.price}**\n🔗 [Voir le produit](${product.link})`,
        color: 0x00bfff,
        footer: { text: "Hacoo Deal 🛍️" },
        timestamp: product.date ? new Date(product.date).toISOString() : new Date().toISOString(),
      }],
    };

    if (product.image) payload.embeds[0].image = { url: product.image };

    await axios.post(WEBHOOK_URL, payload);
    console.log(`✅ Envoyé : ${product.title} — ${product.price}`);
    return true;
  } catch (err) {
    console.error("❌ Erreur Discord :", err.response?.data || err.message);
    return false;
  }
}

// ─────────────────────────────────────────────
// BOUCLE PRINCIPALE
// ─────────────────────────────────────────────
async function main() {
  console.log("\n══════════════════════════════════════");
  const sentLinks = await loadSentLinks();
  let queue = loadQueue();

  // ── Scraping si queue vide ──
  if (queue.length === 0) {
    console.log("🔎 Queue vide — scraping complet de tous les canaux...");

    let allProducts = [];

    for (const channel of TELEGRAM_CHANNELS) {
      const products = await scrapeFullChannel(channel);
      console.log(`   → @${channel} : ${products.length} produits au total`);
      allProducts.push(...products);
    }

    // Filtrer les liens déjà envoyés
    const seenInQueue = new Set();
    const newProducts = allProducts.filter((p) => {
      if (sentLinks.has(p.link) || seenInQueue.has(p.link)) return false;
      seenInQueue.add(p.link);
      return true;
    });

    // ★ MÉLANGER tous les produits de tous les canaux ensemble
    shuffle(newProducts);

    queue = newProducts;
    saveQueue(queue);
    console.log(`\n📬 ${queue.length} nouveaux produits mélangés en file d'attente`);

    if (queue.length === 0) {
      console.log("✅ Rien de nouveau à envoyer.");
      return;
    }
  }

  // ── Envoi du batch de 5 ──
  const batch = queue.splice(0, BATCH_SIZE);
  console.log(`\n📤 Envoi de ${batch.length} produits — ${queue.length} restants...`);

  for (const product of batch) {
    const success = await sendToDiscord(product);
    if (success) sentLinks.add(product.link);
    await new Promise((r) => setTimeout(r, 1500)); // anti-rate-limit Discord
  }

  saveQueue(queue);
  await saveSentLinks(sentLinks);

  if (queue.length > 0) {
    console.log(`⏳ ${queue.length} produits restants — prochain envoi dans 3 minutes...`);
  } else {
    console.log("✅ File terminée ! Prochain scan dans 3 minutes pour les nouvelles annonces.");
  }
}

// Lancement immédiat + toutes les 3 minutes
main();
setInterval(main, INTERVAL_MS);
