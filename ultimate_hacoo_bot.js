const puppeteer = require("puppeteer");
const axios = require("axios");

const WEBHOOK_URL = process.env.WEBHOOK_URL;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

const TELEGRAM_CHANNELS = [
  "https://t.me/s/hacoolinksydeuxx",
  "https://t.me/s/linkscrewfinds",
  "https://t.me/s/mkfashionfinds",
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
    console.log("Erreur canal :", channelUrl, err.message);
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
