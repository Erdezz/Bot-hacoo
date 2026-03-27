const axios = require("axios");
const puppeteer = require("puppeteer");

const WEBHOOK_URL = "https://discord.com/api/webhooks/1484555324810723398/5C_TiGKAdL0HlR6bfHOHPRyhVANsTuxvAplD0F3yDps8HTm-qd358cVP7tR5dCabOVIN";

// 👉 Mets ici tes sources (très important)
const SOURCES = [
  "https://c.onlyaff.app/7oBvx1",
  "https://example2.com"
];

let sentLinks = new Set();

async function getLinksFromSources() {
  let links = [];

  for (let url of SOURCES) {
    try {
      const res = await axios.get(url);
      const matches = res.data.match(/https:\/\/c\.onlyaff\.app\/[a-zA-Z0-9]+/g);

      if (matches) {
        links.push(...matches);
      }
    } catch (err) {
      console.log("Erreur source:", url);
    }
  }

  return [...new Set(links)];
}

async function scrapeProduct(browser, url) {
  try {
    const page = await browser.newPage();

    await page.goto(url, {
      waitUntil: "networkidle2",
      timeout: 30000
    });

    await page.waitForTimeout(3000);

    const data = await page.evaluate(() => {
      const title =
        document.querySelector("h1")?.innerText ||
        "Produit tendance";

      const priceMatch = document.body.innerText.match(/€\s?\d+([.,]\d+)?/);

      const image =
        document.querySelector("img")?.src ||
        null;

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
    return null;
  }
}

async function sendToDiscord(product, link) {
  try {
    await axios.post(WEBHOOK_URL, {
      content:
`✨ **${product.title}**
💸 ${product.price}
🔗 ${link}

#hacoo #fashion #streetwear`,
      embeds: [
        {
          image: {
            url: product.image
          },
          color: 0x00ff99
        }
      ]
    });

    console.log("✅ Envoyé :", product.title);
  } catch (err) {
    console.log("Erreur Discord:", err.message);
  }
}

async function main() {
  console.log("🔎 Recherche de produits...");

  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox"]
  });

  const links = await getLinksFromSources();

  for (let link of links) {
    if (sentLinks.has(link)) continue;

    console.log("🛍️ Nouveau produit :", link);

    const product = await scrapeProduct(browser, link);

    if (product && product.image) {
      await sendToDiscord(product, link);
      sentLinks.add(link);

      await new Promise(r => setTimeout(r, 5000)); // anti-ban
    }
  }

  await browser.close();
}

// 🔁 boucle toutes les 5 min
setInterval(main, 5 * 60 * 1000);

// lancement immédiat
main();
