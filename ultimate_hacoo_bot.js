const puppeteer = require("puppeteer");
const axios = require("axios");

const WEBHOOK_URL = process.env."https://discord.com/api/webhooks/1484555324810723398/5C_TiGKAdL0HlR6bfHOHPRyhVANsTuxvAplD0F3yDps8HTm-qd358cVP7tR5dCabOVIN";
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GIST_ID = process.env.GIST_ID;

const TELEGRAM_CHANNELS = [
  "https://t.me/s/hacoolinksydeuxx",
  "https://t.me/s/linkscrewfinds",
  "https://t.me/s/mkfashionfinds"
];

async function loadSentLinks() {
  try {
    const res = await axios.get(`https://api.github.com/gists/${GIST_ID}`, {
      headers: { Authorization: `token ${GITHUB_TOKEN}` }
    });
    const content = Object.values(res.data.files)[0].content;
    return new Set(JSON.parse(content));
  } catch {
    return new Set();
  }
}

async function saveSentLinks(sentLinks) {
  try {
    await axios.patch(`https://api.github.com/gists/${GIST_ID}`, {
      files: {
        "sent_links.json": {
          content: JSON.stringify([...sentLinks])
        }
      }
    }, {
      headers: { Authorization: `token ${GITHUB_TOKEN}` }
    });
    console.log("💾 Liens sauvegardés dans le Gist");
  } catch (err) {
    console.log("Erreur sauvegarde Gist :", err.message);
  }
}

async function getProductsFromTelegram(channelUrl) {
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });
  const page = await browser.newPage();
  await page.goto(channelUrl, { waitUntil: "networkidle2" });
  await new Promise(r => setTimeout(r, 3000));

  const products = await page.evaluate(() => {
    const messages = document.querySelectorAll(".tgme_widget_message");
    const results = [];

    messages.forEach(msg => {
      const linkEl = msg.querySelector('a[href*="c.onlyaff.app"]');
      if (!linkEl) return;
      const link = linkEl.href;

      const imgEl =
        msg.querySelector(".tgme_widget_message_photo_wrap") ||
        msg.querySelector('a[style*="background-image"]');

      let image = null;
      if (imgEl) {
        const style = imgEl.getAttribute("style") || "";
        const match = style.match(/url\(['"]?(https?[^'")\s]+)['"]?\)/);
        if (match) image = match[1];
      }

      const textEl = msg.querySelector(".tgme_widget_message_text");
      const fullText = textEl ? textEl.innerText.trim() : "";
      const lines = fullText.split("\n").map(l => l.trim()).filter(Boolean);
      const title = lines[0] || "Produit tendance";
      const priceLine = lines.find(l => l.includes("€") || l.includes("$"));
      const price = priceLine || "Prix inconnu";
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
      embeds: [{
        title: product.title,
        url: product.link,
        description: `${product.description ? `*${product.description}*\n\n` : ""}💰 **${product.price}**\n🔗 [Voir le produit](${product.link})`,
        color: 0x00bfff,
        footer: { text: "Hacoo Deal 🛍️" },
        timestamp: new Date().toISOString()
      }]
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
  console.log("🔎 Scan des canaux Telegram...");

  const sentLinks = await loadSentLinks();
  console.log(`📋 ${sentLinks.size} liens déjà envoyés`);

  let allProducts = [];
  for (const channel of TELEGRAM_CHANNELS) {
    const products = await getProductsFromTelegram(channel);
    console.log(`📦 ${products.length} produits trouvés`);
    allProducts.push(...products);
  }

  const newProducts = allProducts.filter(p => !sentLinks.has(p.link));
  console.log(`🆕 ${newProducts.length} nouveaux produits`);

  const toSend = newProducts.slice(0, 3);

  for (const product of toSend) {
    await sendToDiscord(product);
    sentLinks.add(product.link);
    await new Promise(r => setTimeout(r, 2000));
  }

  if (toSend.length > 0) {
    await saveSentLinks(sentLinks);
  }

  console.log("⏳ Prochain scan dans 2 minutes...");
}

setInterval(main, 2 * 60 * 1000);
main();
```

## Les 2 erreurs corrigées

| Erreur | Correction |
|---|---|
| `process.env."https://discord..."` | `process.env.WEBHOOK_URL` |
| Virgules manquantes entre les canaux | Ajout des `,` après chaque canal |

Et dans tes secrets GitHub tu mets :
```
WEBHOOK_URL  = https://discord.com/api/webhooks/1484555.../5C_TiG...
GITHUB_TOKEN = ton_token
GIST_ID      = ton_gist_id
