const puppeteer = require("puppeteer");
const axios = require("axios");

const WEBHOOK_URL = process.env."https://discord.com/api/webhooks/1484555324810723398/5C_TiGKAdL0HlR6bfHOHPRyhVANsTuxvAplD0F3yDps8HTm-qd358cVP7tR5dCabOVIN";
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GIST_ID = process.env.GIST_ID;
const TELEGRAM_BOT_TOKEN = process.env.8623248061:AAH6rBf57jJNftcIOkmp2WruA67zCyC3Zj8;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const TELEGRAM_CHANNELS = [
  "https://t.me/s/hacoolinksydeuxx",
  "https://t.me/s/linkscrewfinds",
  "https://t.me/s/mkfashionfinds",
  "https://t.me/s/QUATRIEME_CANAL"
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

  try {
    await page.goto(channelUrl, { waitUntil: "networkidle2" });
    await new Promise(r => setTimeout(r, 3000));

    // Scroll pour charger un maximum de messages
    await page.evaluate(async () => {
      for (let i = 0; i < 10; i++) {
        window.scrollTo(0, 0);
        await new Promise(r => setTimeout(r, 1000));
      }
    });

    await new Promise(r => setTimeout(r, 2000));

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
        const desc = lines
          .slice(1)
          .filter(l => l !== price && !l.includes("c.onlyaff.app"))
          .join(" • ");

        results.push({ title, price, description: desc, image, link });
      });

      return results;
    });

    await browser.close();
    return products;

  } catch (err) {
    console.log("Erreur Telegram :", channelUrl, err.message);
    await browser.close();
    return [];
  }
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
    console.log("✅ Discord :", product.title);

  } catch (err) {
    console.log("Erreur Discord :", err.response?.data || err.message);
  }
}

async function sendToTelegram(product) {
  try {
    const caption = `*${product.title}*\n${product.description ? `_${product.description}_\n` : ""}💰 ${product.price}\n🔗 ${product.link}`;

    if (product.image) {
      await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`, {
        chat_id: TELEGRAM_CHAT_ID,
        photo: product.image,
        caption: caption,
        parse_mode: "Markdown"
      });
    } else {
      await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
        chat_id: TELEGRAM_CHAT_ID,
        text: caption,
        parse_mode: "Markdown"
      });
    }

    console.log("📨 Telegram :", product.title);

  } catch (err) {
    console.log("Erreur Telegram bot :", err.response?.data || err.message);
  }
}

async function main() {
  console.log("🔎 Scan des 4 canaux Telegram...");

  const sentLinks = await loadSentLinks();
  console.log(`📋 ${sentLinks.size} liens déjà envoyés`);

  let allProducts = [];
  for (const channel of TELEGRAM_CHANNELS) {
    const products = await getProductsFromTelegram(channel);
    console.log(`📦 ${products.length} produits trouvés sur ${channel}`);
    allProducts.push(...products);
  }

  const newProducts = allProducts.filter(p => !sentLinks.has(p.link));
  console.log(`🆕 ${newProducts.length} nouveaux produits`);

  const toSend = newProducts.slice(0, 3);

  for (const product of toSend) {
    await sendToDiscord(product);
    await sendToTelegram(product);
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

## Tes 5 secrets GitHub
```
WEBHOOK_URL          = https://discord.com/api/webhooks/...
GITHUB_TOKEN         = ton_token_github
GIST_ID              = ton_gist_id
TELEGRAM_BOT_TOKEN   = 123456789:AAF-ton-token
TELEGRAM_CHAT_ID     = -1001234567890
