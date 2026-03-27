const puppeteer = require("puppeteer");
const axios = require("axios");

const WEBHOOK_URL = process.env.WEBHOOK_URL || "https://discord.com/api/webhooks/1484555324810723398/5C_TiGKAdL0HlR6bfHOHPRyhVANsTuxvAplD0F3yDps8HTm-qd358cVP7tR5dCabOVIN";
const TELEGRAM_CHANNEL = "https://t.me/s/hacoolinksydeuxx";

let sentLinks = new Set();

// Récupère tous les liens c.onlyaff.app depuis Telegram
async function getLinksFromTelegram() {
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });
  const page = await browser.newPage();
  await page.goto(TELEGRAM_CHANNEL, { waitUntil: "networkidle2" });

  await new Promise(r => setTimeout(r, 3000));

  const links = await page.evaluate(() => {
    const urls = [];
    document.querySelectorAll("a").forEach(a => {
      if (a.href.includes("c.onlyaff.app")) urls.push(a.href);
    });
    return urls;
  });

  await browser.close();
  return [...new Set(links)];
}

// Scraper le produit depuis Hacoo
async function scrapeProduct(url) {
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });
  const page = await browser.newPage();

  try {
    await page.goto(url, { waitUntil: "networkidle0", timeout: 45000 });
    // attendre que le produit soit chargé
    await page.waitForSelector("img", { timeout: 15000 });

    const data = await page.evaluate(() => {
      // Sélecteurs typiques Hacoo (à ajuster si le site change)
      const titleEl = document.querySelector("h1") || document.querySelector(".product-title");
      const priceEl = document.querySelector(".product-price") || document.querySelector("span.price");
      const imgEl = document.querySelector("img") || document.querySelector(".product-image img");
      const descEl = document.querySelector(".product-description") || document.querySelector("p");

      return {
        title: titleEl ? titleEl.innerText.trim() : "Produit tendance",
        price: priceEl ? priceEl.innerText.trim() : "Prix inconnu",
        image: imgEl ? imgEl.src : null,
        description: descEl ? descEl.innerText.trim() : ""
      };
    });

    await page.close();
    return data;
  } catch (err) {
    console.log("Erreur scraping:", url, err.message);
    await page.close();
    return null;
  }
}

// Envoi sur Discord avec image en grand et embed
async function sendToDiscord(product, link) {
  if (!product || !product.image) return;

  try {
    await axios.post(WEBHOOK_URL, {
      content: `**${product.title}**
${product.price}
🔗 ${link}
${product.description}`,
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

  for (let link of links) {
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

// Lancement immédiat
main();
