const puppeteer = require("puppeteer");
const axios = require("axios");

const WEBHOOK_URL = process.env.WEBHOOK_URL || "https://discord.com/api/webhooks/1484555324810723398/5C_TiGKAdL0HlR6bfHOHPRyhVANsTuxvAplD0F3yDps8HTm-qd358cVP7tR5dCabOVIN";
const TELEGRAM_CHANNEL = "https://t.me/s/hacoolinksydeuxx";

let sentLinks = new Set();

// Récupérer tous les liens c.onlyaff.app depuis Telegram
async function getLinksFromTelegram() {
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });
  const page = await browser.newPage();
  await page.goto(TELEGRAM_CHANNEL, { waitUntil: "networkidle2" });

  // Pause compatible
  await new Promise(r => setTimeout(r, 3000));

  const links = await page.evaluate(() => {
    return Array.from(document.querySelectorAll("a"))
      .map(a => a.href)
      .filter(h => h.includes("c.onlyaff.app"));
  });

  await browser.close();
  return [...new Set(links)];
}

// Scraper produit complet depuis Hacoo
async function scrapeProduct(url) {
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });
  const page = await browser.newPage();

  try {
    await page.goto(url, { waitUntil: "networkidle0", timeout: 60000 });

    // Pause pour laisser le contenu dynamique se charger
    await new Promise(r => setTimeout(r, 4000));

    // Extraire données du produit
    const data = await page.evaluate(() => {
      const titleEl = document.querySelector("h1") || document.querySelector(".product-title");
      const priceEl = document.querySelector(".product-price") || document.querySelector("span.price");
      let imgEl = document.querySelector(".product-image img") || document.querySelector("img");
      let img = imgEl ? imgEl.src : null;

      if (!img) {
        const bgEl = document.querySelector(".product-image");
        if (bgEl) {
          const bg = window.getComputedStyle(bgEl).getPropertyValue("background-image");
          const urlMatch = bg.match(/url\("?(.*?)"?\)/);
          if (urlMatch) img = urlMatch[1];
        }
      }

      const descEl = document.querySelector(".product-description") || document.querySelector("p");

      return {
        title: titleEl ? titleEl.innerText.trim() : "Produit tendance",
        price: priceEl ? priceEl.innerText.trim() : "Prix inconnu",
        image: img,
        description: descEl ? descEl.innerText.trim() : ""
      };
    });

    await browser.close();
    return data;

  } catch (err) {
    console.log("Erreur scraping:", url, err.message);
    await browser.close();
    return null;
  }
}

// Envoyer sur Discord
async function sendToDiscord(product, link) {
  if (!product || !product.image) return;

  try {
    await axios.post(WEBHOOK_URL, {
      content: `**${product.title}**\n${product.price}\n🔗 ${link}\n${product.description}`,
      embeds: [
        {
          title: product.title,
          description: product.description || product.price,
          url: link,
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

// Boucle principale
async function main() {
  console.log("🔎 Recherche de produits sur Telegram...");
  const links = await getLinksFromTelegram();

  for (const link of links) {
    if (sentLinks.has(link)) continue;

    console.log("🛍️ Nouveau produit :", link);
    const product = await scrapeProduct(link);

    if (product) {
      await sendToDiscord(product, link);
      sentLinks.add(link);
      await new Promise(r => setTimeout(r, 5000)); // pause anti-ban
    }
  }
}

// Boucle toutes les 5 minutes
setInterval(main, 5 * 60 * 1000);
main();
