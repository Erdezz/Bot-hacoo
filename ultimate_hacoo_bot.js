const puppeteer = require("puppeteer");
const axios = require("axios");

// ─────────────────────────────────────────────
// CONFIGURATION
// ─────────────────────────────────────────────
const WEBHOOK_URL = "https://discord.com/api/webhooks/1484555324810723398/5C_TiGKAdL0HlR6bfHOHPRyhVANsTuxvAplD0F3yDps8HTm-qd358cVP7tR5dCabOVIN";
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GIST_ID = process.env.GIST_ID; 

const TELEGRAM_CHANNELS = [
  "hacoolinksydeuxx",
  "linkscrewfinds",
  "mkfashionfinds"
];

const BATCH_SIZE = 5; // Envoi 5 par 5
const INTERVAL_MS = 5 * 60 * 1000; // Toutes les 5 minutes

// ─────────────────────────────────────────────
// FONCTIONS UTILITAIRES
// ─────────────────────────────────────────────

// Mélange un tableau de façon aléatoire
function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

async function loadData() {
  try {
    const res = await axios.get(`https://api.github.com/gists/${GIST_ID}`, {
      headers: { Authorization: `token ${GITHUB_TOKEN}` }
    });
    return JSON.parse(Object.values(res.data.files)[0].content);
  } catch {
    return { sent: [], queue: [] };
  }
}

async function saveData(sent, queue) {
  try {
    await axios.patch(`https://api.github.com/gists/${GIST_ID}`, {
      files: {
        "data.json": {
          content: JSON.stringify({ sent, queue })
        }
      }
    }, {
      headers: { Authorization: `token ${GITHUB_TOKEN}` }
    });
  } catch (err) {
    console.log("❌ Erreur Gist :", err.message);
  }
}

// ─────────────────────────────────────────────
// SCRAPING
// ─────────────────────────────────────────────

async function getProductsFromTelegram(channelName) {
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });
  const page = await browser.newPage();
  
  // On utilise l'URL de preview publique de Telegram
  await page.goto(`https://t.me/s/${channelName}`, { waitUntil: "networkidle2" });
  await new Promise(r => setTimeout(r, 2000));

  const products = await page.evaluate(() => {
    const results = [];
    document.querySelectorAll(".tgme_widget_message").forEach(msg => {
      const linkEl = msg.querySelector('a[href*="c.onlyaff.app"]');
      if (!linkEl) return;

      const imgEl = msg.querySelector(".tgme_widget_message_photo_wrap") || 
                    msg.querySelector('a[style*="background-image"]');
      
      let image = null;
      if (imgEl) {
        const style = imgEl.getAttribute("style") || "";
        const match = style.match(/url\(['"]?(https?[^'")\s]+)['"]?\)/);
        if (match) image = match[1];
      }

      const textEl = msg.querySelector(".tgme_widget_message_text");
      const lines = textEl ? textEl.innerText.trim().split("\n") : [];
      
      results.push({
        title: lines[0] || "Produit Hacoo",
        price: lines.find(l => l.includes("€") || l.includes("$")) || "Voir prix",
        description: lines.slice(1, 3).join(" ").substring(0, 200),
        image,
        link: linkEl.href
      });
    });
    return results;
  });

  await browser.close();
  return products;
}

// ─────────────────────────────────────────────
// EXECUTION PRINCIPALE
// ─────────────────────────────────────────────

async function main() {
  console.log("🔄 Début du cycle...");
  
  // 1. Charger l'historique et la file d'attente
  let data = await loadData();
  let sentSet = new Set(data.sent);
  let queue = data.queue || [];

  // 2. Scanner les canaux pour trouver des nouveaux produits
  for (const channel of TELEGRAM_CHANNELS) {
    console.log(`📡 Scraping @${channel}...`);
    const found = await getProductsFromTelegram(channel);
    
    // Ajouter seulement ceux qu'on n'a jamais vu (ni envoyé, ni déjà en queue)
    found.forEach(p => {
      if (!sentSet.has(p.link) && !queue.some(q => q.link === p.link)) {
        queue.push(p);
      }
    });
  }

  console.log(`📦 Produits en attente : ${queue.length}`);

  if (queue.length === 0) {
    console.log("✅ Rien de nouveau à envoyer.");
    return;
  }

  // 3. Mélanger TOUTE la file d'attente (Aléatoire de tous les canaux)
  queue = shuffle(queue);

  // 4. Prendre les 5 premiers
  const toSend = queue.splice(0, BATCH_SIZE);

  for (const product of toSend) {
    try {
      await axios.post(WEBHOOK_URL, {
        embeds: [{
          title: product.title,
          url: product.link,
          description: `💰 **${product.price}**\n\n${product.description}`,
          image: product.image ? { url: product.image } : null,
          color: 0x00ff00,
          footer: { text: "🛍️ Hacoo Deals Aléatoires" },
          timestamp: new Date().toISOString()
        }]
      });
      sentSet.add(product.link);
      console.log(`✅ Envoyé : ${product.title}`);
    } catch (e) {
      console.log("❌ Erreur Discord");
    }
    await new Promise(r => setTimeout(r, 1500));
  }

  // 5. Sauvegarder l'état mis à jour
  await saveData([...sentSet], queue);
  console.log(`⏳ Cycle terminé. Prochain scan dans 5 minutes.`);
}

// Lancement
setInterval(main, INTERVAL_MS);
main();
