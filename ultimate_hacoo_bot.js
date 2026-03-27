const puppeteer = require("puppeteer");
const axios = require("axios");
const fs = require("fs");
const path = require("path");

// ─────────────────────────────────────────────
// CONFIG — mets tes vraies valeurs ici ou dans les secrets GitHub Actions
// ─────────────────────────────────────────────
const WEBHOOK_URL = process.env.WEBHOOK_URL || "https://discord.com/api/webhooks/1484555324810723398/5C_TiGKAdL0HlR6bfHOHPRyhVANsTuxvAplD0F3yDps8HTm-qd358cVP7tR5dCabOVIN";
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GIST_ID = process.env.GIST_ID; // ID de ton Gist GitHub

const TELEGRAM_CHANNELS = [
  "https://t.me/s/hacoolinksydeuxx",
  "https://t.me/s/linkscrewfinds",
  "https://t.me/s/mkfashionfinds",
];

// Fichier local de secours si le Gist est indisponible
const LOCAL_CACHE_FILE = path.join(__dirname, "sent_links_cache.json");

// ─────────────────────────────────────────────
// GESTION DES LIENS DÉJÀ ENVOYÉS
// ─────────────────────────────────────────────

async function loadSentLinks() {
  // 1. Essayer le Gist GitHub
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
      console.warn("⚠️ Impossible de charger le Gist, fallback local :", err.message);
    }
  }

  // 2. Fallback : fichier local
  try {
    if (fs.existsSync(LOCAL_CACHE_FILE)) {
      const content = fs.readFileSync(LOCAL_CACHE_FILE, "utf-8");
      const links = JSON.parse(content);
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

  // 1. Sauvegarder dans le Gist GitHub
  if (GITHUB_TOKEN && GIST_ID) {
    try {
      await axios.patch(
        `https://api.github.com/gists/${GIST_ID}`,
        {
          files: {
            "sent_links.json": {
              content: JSON.stringify(data, null, 2),
            },
          },
        },
        {
          headers: { Authorization: `token ${GITHUB_TOKEN}` },
        }
      );
      console.log("💾 Gist mis à jour");
    } catch (err) {
      console.warn("⚠️ Erreur sauvegarde Gist :", err.message);
    }
  }

  // 2. Toujours sauvegarder en local aussi (double sécurité)
  try {
    fs.writeFileSync(LOCAL_CACHE_FILE, JSON.stringify(data, null, 2), "utf-8");
    console.log("💾 Cache local mis à jour");
  } catch (err) {
    console.warn("⚠️ Erreur sauvegarde locale :", err.message);
  }
}

// ─────────────────────────────────────────────
// SCRAPING TELEGRAM
// ─────────────────────────────────────────────

async function getProductsFromTelegram(channelUrl) {
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: "new",
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    const page = await browser.newPage();
    await page.goto(channelUrl, { waitUntil: "networkidle2", timeout: 30000 });
    await new Promise((r) => setTimeout(r, 3000));

    const products = await page.evaluate(() => {
      const messages = document.querySelectorAll(".tgme_widget_message");
      const results = [];

      messages.forEach((msg) => {
        const linkEl = msg.querySelector('a[href*="c.onlyaff.app"]');
        if (!linkEl) return;

        const link = linkEl.href;

        // Récupération de l'image
        const imgEl =
          msg.querySelector(".tgme_widget_message_photo_wrap") ||
          msg.querySelector('a[style*="background-image"]');

        let image = null;
        if (imgEl) {
          const style = imgEl.getAttribute("style") || "";
          const match = style.match(/url\(['"]?(https?[^'")\s]+)['"]?\)/);
          if (match) image = match[1];
        }

        // Récupération du texte
        const textEl = msg.querySelector(".tgme_widget_message_text");
        const fullText = textEl ? textEl.innerText.trim() : "";
        const lines = fullText
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean);

        const title = lines[0] || "Produit tendance";
        const priceLine = lines.find((l) => l.includes("€") || l.includes("$"));
        const price = priceLine || "Prix inconnu";
        const desc = lines
          .slice(1)
          .filter((l) => l !== price && !l.includes("c.onlyaff.app"))
          .join(" • ");

        results.push({ title, price, description: desc, image, link });
      });

      return results;
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
          title: product.title.slice(0, 256), // limite Discord
          url: product.link,
          description:
            (product.description ? `*${product.description}*\n\n` : "") +
            `💰 **${product.price}**\n🔗 [Voir le produit](${product.link})`,
          color: 0x00bfff,
          footer: { text: "Hacoo Deal 🛍️" },
          timestamp: new Date().toISOString(),
        },
      ],
    };

    if (product.image) {
      payload.embeds[0].image = { url: product.image };
    }

    await axios.post(WEBHOOK_URL, payload);
    console.log(`✅ Envoyé : ${product.title} — ${product.price}`);
  } catch (err) {
    console.error("❌ Erreur Discord :", err.response?.data || err.message);
  }
}

// ─────────────────────────────────────────────
// BOUCLE PRINCIPALE
// ─────────────────────────────────────────────

async function main() {
  console.log("\n🔎 Scan des canaux Telegram...");

  const sentLinks = await loadSentLinks();
  console.log(`📋 ${sentLinks.size} liens déjà envoyés en mémoire`);

  let allProducts = [];
  for (const channel of TELEGRAM_CHANNELS) {
    console.log(`📡 Scraping : ${channel}`);
    const products = await getProductsFromTelegram(channel);
    console.log(`   → ${products.length} produits trouvés`);
    allProducts.push(...products);
  }

  // Filtrer les doublons (même run) + liens déjà envoyés
  const seenThisRun = new Set();
  const newProducts = allProducts.filter((p) => {
    if (sentLinks.has(p.link) || seenThisRun.has(p.link)) return false;
    seenThisRun.add(p.link);
    return true;
  });

  console.log(`🆕 ${newProducts.length} nouveaux produits à envoyer`);

  // Limite de 5 envois par cycle pour éviter le spam
  const toSend = newProducts.slice(0, 5);

  for (const product of toSend) {
    await sendToDiscord(product);
    sentLinks.add(product.link);
    await new Promise((r) => setTimeout(r, 2000)); // délai anti-rate-limit Discord
  }

  if (toSend.length > 0) {
    await saveSentLinks(sentLinks);
  }

  console.log("⏳ Prochain scan dans 2 minutes...\n");
}

// Lancement immédiat + toutes les 2 minutes
main();
setInterval(main, 2 * 60 * 1000);
