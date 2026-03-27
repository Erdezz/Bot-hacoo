const puppeteer = require("puppeteer");
const axios = require("axios");

const WEBHOOK_URL = process.env.WEBHOOK_URL || "https://discord.com/api/webhooks/1484555324810723398/5C_TiGKAdL0HlR6bfHOHPRyhVANsTuxvAplD0F3yDps8HTm-qd358cVP7tR5dCabOVIN";
const TELEGRAM_CHANNEL = "https://t.me/s/hacoolinksydeuxx";
let sentLinks = new Set();

async function getLinksFromTelegram() {
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });
  const page = await browser.newPage();
  await page.goto(TELEGRAM_CHANNEL, { waitUntil: "networkidle2" });
  await new Promise(r => setTimeout(r, 3000));
  const links = await page.evaluate(() => {
    return Array.from(document.querySelectorAll("a"))
      .map(a => a.href)
      .filter(h => h.includes("c.onlyaff.app"));
  });
  await browser.close();
  return [...new Set(links)];
}

async function scrapeProduct(url) {
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });
  const page = await browser.newPage();

  try {
    // Intercepter les redirections pour avoir l'URL finale
    await page.setRequestInterception(false);

    // Attendre que la page soit complètement chargée après redirections
    await page.goto(url, { waitUntil: "networkidle0", timeout: 60000 });
    await new Promise(r => setTimeout(r, 5000)); // attendre le JS dynamique

    const finalUrl = page.url();
    console.log("URL finale :", finalUrl);

    const data = await page.evaluate(() => {
      // Hacoo - sélecteurs spécifiques
      const titleEl =
        document.querySelector(".goods-name") ||
        document.querySelector(".product-name") ||
        document.querySelector('[class*="title"]') ||
        document.querySelector("h1");

      const priceEl =
        document.querySelector(".goods-price") ||
        document.querySelector('[class*="price"]') ||
        document.querySelector(".price");

      // Image principale du produit
      const imgEl =
        document.querySelector(".goods-img img") ||
        document.querySelector(".swiper-slide img") ||
        document.querySelector('[class*="product"] img') ||
        document.querySelector("img");

      const descEl =
        document.querySelector(".goods-desc") ||
        document.querySelector('[class*="desc"]') ||
        document.querySelector(".detail");

      return {
        title: titleEl ? titleEl.innerText.trim() : null,
        price: priceEl ? priceEl.innerText.trim() : null,
        image: imgEl ? imgEl.src : null,
        description: descEl ? descEl.innerText.trim().slice(0, 200) : "",
        url: window.location.href
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

async function sendToDiscord(product, link) {
  try {
    const title = product.title || "Produit tendance";
    const price = product.price || "Prix inconnu";
    const image = product.image;

    const payload = {
      embeds: [
        {
          title: title,
          url: product.url || link,
          description: `💰 **Prix :** ${price}\n\n${product.description || ""}`,
          color: 0x00ff99,
          footer: { text: "Hacoo Deal 🛍️" },
          timestamp: new Date().toISOString()
        }
      ]
    };

    // Ajouter l'image seulement si elle existe
    if (image && image.startsWith("http")) {
      payload.embeds[0].image = { url: image };
    }

    await axios.post(WEBHOOK_URL, payload);
    console.log("✅ Envoyé :", title, "-", price);

  } catch (err) {
    console.log("Erreur Discord :", err.response?.data || err.message);
  }
}

async function main() {
  console.log("🔎 Recherche de produits sur Telegram...");
  const links = await getLinksFromTelegram();
  console.log(`📦 ${links.length} liens trouvés`);

  for (const link of links) {
    if (sentLinks.has(link)) continue;
    console.log("🛍️ Nouveau produit :", link);
    const product = await scrapeProduct(link);

    if (product && product.title) {
      await sendToDiscord(product, link);
      sentLinks.add(link);
      await new Promise(r => setTimeout(r, 5000));
    } else {
      console.log("⚠️ Produit vide, ignoré :", link);
    }
  }
}

setInterval(main, 5 * 60 * 1000);
main();
