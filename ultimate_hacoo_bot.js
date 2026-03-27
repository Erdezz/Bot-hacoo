const puppeteer = require("puppeteer");
const axios = require("axios");

// ─────────────────────────────────────────────────────────────────────────────
// CONFIGURATION (METS TES INFOS ICI)
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
const INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

// ─────────────────────────────────────────────────────────────────────────────
// FONCTIONS D'ENVOI (VERSION STABLE SANS ERREUR D'IMAGE)
// ─────────────────────────────────────────────────────────────────────────────

async function sendToTelegram(product) {
    const url = `https://api.telegram.org/bot${CONFIG.telegramToken}/sendMessage`;
    try {
        await axios.post(url, {
            chat_id: CONFIG.telegramChatId,
            text: `🛍️ **${product.title}**\n💰 **${product.price}**\n\n🔗 ${product.link}`,
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
            content: `🛍️ **${product.title}**\n💰 **${product.price}**\n🔗 ${product.link}`
        });
        console.log(`✅ DISCORD OK: ${product.title}`);
    } catch (e) {
        console.log("❌ Erreur Discord");
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// GESTION GIST (POUR ÉVITER LES DOUBLONS)
// ─────────────────────────────────────────────────────────────────────────────

async function loadData() {
    try {
        const res = await axios.get(`https://api.github.com/gists/${CONFIG.gistId}`, {
            headers: { Authorization: `token ${CONFIG.githubToken}` }
        });
        const content = JSON.parse(Object.values(res.data.files)[0].content);
        return content;
    } catch (e) {
        console.log("⚠️ Erreur Gist (401). Vérifie ton GITHUB_TOKEN et l'ID du Gist.");
        return { sent: [], queue: [] };
    }
}

async function saveData(sent, queue) {
    try {
        await axios.patch(`https://api.github.com/gists/${CONFIG.gistId}`, {
            files: { "data.json": { content: JSON.stringify({ sent, queue }) } }
        }, { headers: { Authorization: `token ${CONFIG.githubToken}` } });
    } catch (e) { 
        console.log("❌ Sauvegarde Gist échouée."); 
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// SCRAPING & COEUR DU BOT
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
    console.log("\n--- DEBUT DU CYCLE ---");
    let data = await loadData();
    let sentSet = new Set(data.sent || []);
    let queue = data.queue || [];

    let browser;
    try {
        browser = await puppeteer.launch({ 
            headless: "new", 
            args: ["--no-sandbox", "--disable-setuid-sandbox"] 
        });
        const page = await browser.newPage();

        for (const chan of CONFIG.channelsToScan) {
            console.log(`🔍 Scan @${chan}...`);
            try {
                await page.goto(`https://t.me/s/${chan}`, { waitUntil: "networkidle2", timeout: 30000 });
                const found = await page.evaluate(() => {
                    const items = [];
                    document.querySelectorAll(".tgme_widget_message").forEach(msg => {
                        const link = msg.querySelector('a[href*="c.onlyaff.app"]')?.href;
                        if (!link) return;
                        const text = msg.querySelector(".tgme_widget_message_text")?.innerText || "";
                        const lines = text.split("\n");
                        items.push({
                            title: lines[0]?.substring(0, 100) || "Produit Hacoo",
                            price: lines.find(l => l.includes("€")) || "Voir prix",
                            link: link
                        });
                    });
                    return items;
                });

                found.forEach(p => {
                    if (!sentSet.has(p.link) && !queue.some(q => q.link === p.link)) {
                        queue.push(p);
                    }
                });
            } catch (err) {
                console.log(`❌ Impossible de scanner ${chan}`);
            }
        }
    } catch (e) {
        console.log("❌ Erreur Browser");
    } finally {
        if (browser) await browser.close();
    }

    if (queue.length > 0) {
        const toSend = queue.splice(0, BATCH_SIZE);
        for (const product of toSend) {
            await sendToDiscord(product);
            await sendToTelegram(product);
            sentSet.add(product.link);
            await new Promise(r => setTimeout(r, 2000));
        }
    }

    await saveData([...sentSet], queue);
    console.log("--- FIN DU CYCLE (Prochain dans 5 min) ---");
}

main();
setInterval(main, INTERVAL_MS);
