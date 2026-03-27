const puppeteer = require("puppeteer");
const axios = require("axios");

// Ton webhook Discord (ou via variable d'environnement Railway)
const WEBHOOK_URL = process.env.WEBHOOK_URL || "https://discord.com/api/webhooks/1484555324810723398/5C_TiGKAdL0HlR6bfHOHPRyhVANsTuxvAplD0F3yDps8HTm-qd358cVP7tR5dCabOVIN";

// Canal Telegram public à scraper
const TELEGRAM_CHANNEL = "https://t.me/s/hacoolinksydeuxx";

// Mémoire des liens déjà envoyés
let sentLinks = new Set();

// Récupérer tous les liens c.onlyaff.app depuis Telegram
async function getLinksFromTelegram() {
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });

  const page = await browser.newPage();
  await page.goto(TELEGRAM_CHANNEL, { waitUntil: "networkidle2" });

  // Petit délai pour que la page charge correctement
  await new Promise(r => setTimeout(r, 3000));

  const links = await page.evaluate(() => {
    const urls = [];
    document.querySelectorAll("a").forEach(a => {
      if (a.href.includes("c.onlyaff.app")) urls.push(a.href);
    });
    return urls;
  });

  await browser.close();
  return [...new Set(links)]; // retire les doublons
}

// Scraper le produit pour récupérer titre, prix et image
async function scrapeProduct(url) {
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });

  const page = await browser.newPage();
  try {
    await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });

    // Petit délai pour charger les images et le texte
    await new Promise(r => setTimeout(r, 3000));

    const data = await page.evaluate(() => {
      const title = document.querySelector("h1")?.innerText || "Produit tendance";
      const priceMatch = document.body.innerText.match(/€\s?\d+([.,]\d+)?/);
      const image = document.querySelector("img")?.src || null;
      return {
        title,
        price: priceMatch ? priceMatch[0] : "Prix inconnu",
        image
      };
    });

    await page.close();
    return data;
  } catch (err) {
    console.log("Erreur scraping:", url);
    await page.close();
    return null;
  }
}

// Envoyer le produit sur Discord via webhook
async function sendToDiscord(product, link) {
  if (!product || !product.image) return;

  try {
    await axios.post(WEBHOOK_URL, {
      content: `✨ **${product.title}**
💸 ${product.price}
🔗 ${link}

#hacoo #fashion #streetwear`,
      embeds: [
        {
          image: { url: product.image },
          color: 0x00ff99
        }
      ]
    });
    console.log("✅ Envoyé :", product.title);
  } catch (err) {
    console.log("Erreur Discord :", err.message);
  }
}

// Fonction principale : récupère les liens, scrape et envoie
async function main() {
  console.log("🔎 Recherche de produits sur Telegram...");

  const links = await getLinksFromTelegram();

  for (let link of links) {
    if (sentLinks.has(link)) continue;

    console.log("🛍️ Nouveau produit :", link);
    const product = await scrapeProduct(link);
    if (product) {
      await sendToDiscord(product, link);
      sentLinks.add(link);

      // Pause de 5 secondes entre chaque envoi pour éviter les restrictions
      await new Promise(r => setTimeout(r, 5000));
    }
  }
}

// Boucle toutes les 5 minutes
setInterval(main, 5 * 60 * 1000);

// Lancement immédiat
main();
