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
  "https://t.me/s/hacoolinksydeuxx",
  "https://t.me/s/linkscrewfinds",
  "https://t.me/s/mkfashionfinds",
];

const LOCAL_CACHE_FILE = path.join(__dirname, "sent_links_cache.json");
const QUEUE_FILE = path.join(__dirname, "queue.json"); // file d'attente persistante
const BATCH_SIZE = 5; // envois par cycle de 2 min

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
      console.log(`✅ Gist chargé : ${links.length} liens`);
      return new Set(links);
    } catch (err) {
      console.warn("⚠️ Gist indisponible, fallback local :", err.message);
    }
  }

  try {
    if (fs.existsSync(LOCAL_CACHE_FILE)) {
      const links = JSON.parse(fs.readFileSync(LOCAL_CACHE_FILE, "utf-8"));
      console.log(`📁 Cache local chargé : ${links.length} liens`);
      return new Set(links);
    }
  } catch (err) {
    console.warn("⚠️ Erreur lecture cache local :", err.message);
  }

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
      console.log("💾 Gist mis à jour");
    } catch (err) {
      console.warn("⚠️ Erreur sauvegarde Gist :", err.message);
    }
  }

  try {
    fs.writeFileSync(LOCAL_CACHE_FILE, JSON.stringify(data, null, 2), "utf-8");
  } catch (err) {
    console.warn("⚠️ Erreur sauvegarde locale :", err.message);
  }
}

// ─────────────────────────────────────────────
// FILE D'ATTENTE persistante
// ─────────────────────────────────────────────

function loadQueue() {
  try {
    if (fs.existsSync(QUEUE_FILE)) {
      const data = JSON.parse(fs.readFileSync(QUEUE_FILE, "utf-8"));
      console.log(`📬 Queue chargée : ${data.length} produits en attente`);
      return data;
    }
  } catch (err) {
    console.warn("⚠️ Erreur lecture queue :", err.message);
  }
  return [];
}

function saveQueue(queue) {
  try {
    fs.writeFileSync(QUEUE_FILE, JSON.stringify(queue, null, 2), "utf-8");
  } catch (err) {
    console.warn("⚠️ Erreur sauvegarde queue :", err.message);
  }
}

// ─────────────────────────────────────────────
// SCRAPING TELEGRAM avec scroll complet
// ─────────────────────────────────────────────

async function getAllProductsFromTelegram(channelUrl) {
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: "new",
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    const page = await browser.newPage();
    await page.goto(channelUrl, { waitUntil: "networkidle2", timeout: 60000 });
    await new Promise((r) => setTimeout(r, 3000));

    console.log(`   🔄 Scroll vers le haut pour charger tous les messages...`);

    // Scroll répété vers le haut pour déclencher le chargement des anciens messages
    let previousHeight = 0;
    let sameHeightCount = 0;

    while (sameHeightCount < 6) {
      await page.evaluate(() => window.scrollTo(0, 0));
      await new Promise((r) => setTimeout(r, 2500));

      const currentHeight = await page.evaluate(() => document.body.scrollHeight);

      if (currentHeight === previousHeight) {
        sameHeightCount++;
      } else {
        sameHeightCount = 0;
        previousHeight = currentHeight;
        const msgCount = await page.evaluate(
          () => document.querySelectorAll(".tgme_widget_message").length
        );
        console.log(`   📜 ${msgCount} messages chargés (hauteur: ${currentHeight}px)`);
      }
    }

    console.log(`   ✅ Chargement terminé, extraction...`);

    const products = await page.evaluate(() => {
      const messages = document.querySelectorAll(".tgme_widget_message");
      const results = [];

      messages.forEach((msg) => {
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

        results.push({ title, price, description: desc, image, link, date });
      });

      // Du plus ancien au plus récent
      return results.sort((a, b) => {
        if (!a.date) return 1;
        if (!b.date) return -1;
        return new Date(a.date) - new Date(b.date);
      });
    });

    return products;
  } catch (err) {
    console.error(`❌ Erreur scraping ${channelUrl} :`, err.message);
    return [];
  } finally {
    if (browser) await browser.close();
  }
}

// ─────────────────────────────────────────────
// ENVOI DISCORD
// ─────────────────────────────────────────────

async function sendToDiscord(product) {
  try {
    const payload = {
      embeds: [
        {
          title: product.title.slice(0, 256),
          url: product.link,
          description:
            (product.description ? `*${product.description}*\n\n` : "") +
            `💰 **${product.price}**\n🔗 [Voir le produit](${product.link})`,
          color: 0x00bfff,
          footer: { text: "Hacoo Deal 🛍️" },
          timestamp: product.date
            ? new Date(product.date).toISOString()
            : new Date().toISOString(),
        },
      ],
    };

    if (product.image) {
      payload.embeds[0].image = { url: product.image };
    }

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

let scrapingDone = false;

async function main() {
  console.log("\n──────────────────────────────────");
  const sentLinks = await loadSentLinks();
  let queue = loadQueue();

  // ── Phase 1 : Scraping initial (quand la queue est vide) ──
  if (queue.length === 0) {
    console.log("🔎 Queue vide — scraping complet de tous les canaux...");
    scrapingDone = false;

    for (const channel of TELEGRAM_CHANNELS) {
      console.log(`📡 Canal : ${channel}`);
      const products = await getAllProductsFromTelegram(channel);
      console.log(`   → ${products.length} produits trouvés`);

      const seenInQueue = new Set(queue.map((p) => p.link));
      for (const p of products) {
        if (!sentLinks.has(p.link) && !seenInQueue.has(p.link)) {
          queue.push(p);
          seenInQueue.add(p.link);
        }
      }
    }

    saveQueue(queue);
    console.log(`\n📬 ${queue.length} nouveaux produits en file d'attente`);

    if (queue.length === 0) {
      console.log("✅ Rien de nouveau à envoyer.");
      return;
    }
  }

  // ── Phase 2 : Envoi du prochain batch de 5 ──
  const batch = queue.splice(0, BATCH_SIZE);
  console.log(`📤 Envoi de ${batch.length} produits — ${queue.length} restants en file...`);

  for (const product of batch) {
    const success = await sendToDiscord(product);
    if (success) sentLinks.add(product.link);
    await new Promise((r) => setTimeout(r, 1500));
  }

  saveQueue(queue);
  await saveSentLinks(sentLinks);

  if (queue.length > 0) {
    console.log(`⏳ ${queue.length} produits restants — prochain envoi dans 2 minutes...`);
  } else {
    console.log("✅ Toute la file envoyée ! Prochain scan pour nouvelles annonces dans 2 min.");
  }
}

main();
setInterval(main, 2 * 60 * 1000);
