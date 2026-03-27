const puppeteer = require("puppeteer");
const axios = require("axios");

const WEBHOOK_URL = process.env.WEBHOOK_URL || "https://discord.com/api/webhooks/1484555324810723398/5C_TiGKAdL0HlR6bfHOHPRyhVANsTuxvAplD0F3yDps8HTm-qd358cVP7tR5dCabOVIN";
const TELEGRAM_CHANNEL = "https://t.me/s/hacoolinksydeuxx";
let sentLinks = new Set();

async function getProductsFromTelegram() {
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });
  const page = await browser.newPage();
  await page.goto(TELEGRAM_CHANNEL, { waitUntil: "networkidle2" });
  await new Promise(r => setTimeout(r, 3000));

  const products = await page.evaluate(() => {
    const messages = document.querySelectorAll(".tgme_widget_message");
    const results = [];

    messages.forEach(msg => {
      // Récupérer le lien c.onlyaff.app
      const linkEl = msg.querySelector('a[href*="c.onlyaff.app"]');
      if (!linkEl) return;
      const link = linkEl.href;

      // Récupérer l'image (photo du message Telegram)
      const imgEl =
        msg.querySelector(".tgme_widget_message_photo_wrap") ||
        msg.querySelector('a[style*="background-image"]');

      let image = null;
      if (imgEl) {
        const style = imgEl.getAttribute("style") || "";
        const match = style.match(/url\(['"]?(https?[^'")\s]+)['"]?\)/);
        if (match) image = match[1];
      }

      // Récupérer le texte du message (titre + prix)
      const textEl = msg.querySelector(".tgme_widget_message_text");
      const fullText = textEl ? textEl.innerText.trim() : "";

      // Parser le texte
      const lines = fullText.split("\n").map(l => l.trim()).filter(Boolean);
      const title = lines[0] || "Produit tendance";

      // Chercher le prix (ligne avec €)
      const priceLine = lines.find(l => l.includes("€") || l.includes("$"));
      const price = priceLine || "Prix inconnu";

      // Description = lignes entre titre et prix
      const desc = lines.slice(1).filter(l => l !== price && !l.includes("c.onlyaff.app")).join(" • ");

      results.push({ title, price, description: desc, image, link });
    });

    return results;
  });

  await browser.close();
  return products;
}

async function sendToDiscord(product) {
  try {
    const payload = {
      embeds: [
        {
          title: product.title,
          url: product.link,
          description: `${product.description ? `*${product.description}*\n\n` : ""}💰 **${product.price}**\n🔗 [Voir le produit](${product.link})`,
          color: 0x00bfff,
          footer: { text: "Hacoo Deal 🛍️" },
          timestamp: new Date().toISOString()
        }
      ]
    };

    if (product.image) {
      payload.embeds[0].image = { url: product.image };
    }

    await axios.post(WEBHOOK_URL, payload);
    console.log("✅ Envoyé :", product.title, "-", product.price);

  } catch (err) {
    console.log("Erreur Discord :", err.response?.data || err.message);
  }
}

async function main() {
  console.log("🔎 Scan Telegram...");
  const products = await getProductsFromTelegram();
  console.log(`📦 ${products.length} produits trouvés`);

  for (const product of products) {
    if (sentLinks.has(product.link)) continue;

    console.log("🛍️", product.title, "-", product.price);
    await sendToDiscord(product);
    sentLinks.add(product.link);
    await new Promise(r => setTimeout(r, 3000));
  }
}

setInterval(main, 5 * 60 * 1000);
main();
