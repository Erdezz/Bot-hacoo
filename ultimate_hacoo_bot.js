const puppeteer = require("puppeteer");
const axios = require("axios");

// ─────────────────────────────────────────────────────────────────────────────
// CONFIGURATION DIRECTE (REMPLACE LES VALEURS ENTRE GUILLEMETS)
// ─────────────────────────────────────────────────────────────────────────────
const CONFIG = {
    discordWebhook: "https://discord.com/api/webhooks/1484555324810723398/5C_TiGKAdL0HlR6bfHOHPRyhVANsTuxvAplD0F3yDps8HTm-qd358cVP7tR5dCabOVIN",
    githubToken: "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",
    gistId: "b303d0abe87fb107b23280c4b284ee70",
    telegramToken: "8770013859:AAE3KknyIsHwujpL_BgI3RAeWlDHbtEzrsU",
    telegramChatId: "-1003725676174", // Ton ID vérifié
    channelsToScan: ["hacoolinksydeuxx", "linkscrewfinds", "mkfashionfinds"]
};

const BATCH_SIZE = 5;
const INTERVAL_MS = 5 * 60 * 1000;

// ─────────────────────────────────────────────────────────────────────────────
// FONCTIONS DE COMMUNICATION
// ─────────────────────────────────────────────────────────────────────────────

async function sendToTelegram(product) {
    const url = `https://api.telegram.org/bot${CONFIG.telegramToken}/sendPhoto`;
    try {
        await axios.post(url, {
            chat_id: CONFIG.telegramChatId,
            photo: product.image || "https://placehold.co/600x400?text=Hacoo+Deals",
            caption: `🛍️ **${product.title}**\n💰 **${product.price}**\n🔗 [VOIR LE PRODUIT](${product.link})`,
            parse_mode: "Markdown"
        });
        console.log(`✈️ TG OK: ${product.title}`);
    } catch (e) {
        console.log(`❌ Erreur TG: ${e.response?.data?.description || e.message}`);
    }
}

async function sendToDiscord(product) {
    try {
        await axios.post(CONFIG.discordWebhook, {
            embeds: [{
                title: product.title,
                url: product.link,
                description: `💰 **${product.price}**`,
                image: product.image ? { url: product.image } : null,
                color: 0x00ff00
            }]
        });
        console.log(`✅ DISCORD OK: ${product.title}`);
    } catch (e) {
        console.log("❌ Erreur Discord");
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// GESTION DES DONNÉES (GIST)
// ─────────────────────────────────────────────────────────────────────────────

async function loadData() {
    try {
        const res = await axios.get(`https://api.github.com/gists/${CONFIG.gistId}`, {
            headers: { Authorization: `token ${CONFIG.githubToken}` }
        });
        return JSON.parse(Object.values(res.data.files)[0].content);
    } catch (e) {
        console.log("⚠️ Erreur Gist (401 ou ID faux). Le bot va doubler les messages.");
        return { sent: [], queue: [] };
    }
}

async function saveData(sent, queue) {
    try {
        await axios.patch(`https://api.github.com/gists/${CONFIG.gistId}`, {
            files: { "data.json": { content: JSON.stringify({ sent, queue }) } }
        }, { headers: { Authorization: `token ${CONFIG.githubToken}` } });
    } catch (e) { console.log("❌ Impossible de sauvegarder sur Gist"); }
}

// ─────────────────────────────────────────────────────────────────────────────
// SCRAPER ET CŒUR DU BOT
// ─────────────────────────────────────────────────────────────────────────────

async function scrapeChannel(channelName) {
    let browser;
    try {
        browser = await puppeteer.launch({ headless: "new", args: ["--no-sandbox"] });
        const page = await browser.newPage();
        await page.goto(`https://t.me/s/${channelName}`, { waitUntil: "networkidle2", timeout: 60000 });
        
        return await page.evaluate(() => {
            const results = [];
            document.querySelectorAll(".tgme_widget_message").forEach(msg => {
                const link = msg.querySelector('a[href*="c.onlyaff.app"]')?.href;
                if (!link) return;
                
                const text = msg.querySelector(".tgme_widget_message_text")?.innerText || "";
                const lines = text.split("\n");
                
                results.push({
                    title: lines[0] || "Produit Hacoo",
                    price: lines.find(l => l.includes("€")) || "Voir prix",
                    link: link,
                    image: "" // Le scraping d'image est simplifié pour la stabilité
                });
            });
            return results;
        });
    } catch (e) { return []; } 
    finally { if (browser) await browser.close(); }
}

async function main() {
    console.log("\n--- DEBUT DU CYCLE ---");
    let data = await loadData();
    let sentSet = new Set(data.sent || []);
    let queue = data.queue || [];

    for (const chan of CONFIG.channelsToScan) {
        console.log(`🔍 Scan @${chan}...`);
        const found = await scrapeChannel(chan);
        found.forEach(p => {
            if (!sentSet.has(p.link) && !queue.some(q => q.link === p.link)) {
                queue.push(p);
            }
        });
    }

    if (queue.length > 0) {
        const toSend = queue.splice(0, BATCH_SIZE);
        for (const product of toSend) {
            await sendToDiscord(product);
            await sendToTelegram(product);
            sentSet.add(product.link);
            await new Promise(r => setTimeout(r, 3000));
        }
    }

    await saveData([...sentSet], queue);
    console.log("--- FIN DU CYCLE ---");
}

main();
setInterval(main, INTERVAL_MS);
