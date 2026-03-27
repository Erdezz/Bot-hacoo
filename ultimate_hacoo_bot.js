const puppeteer = require("puppeteer");
const axios = require("axios");

// ─────────────────────────────────────────────────────────────────────────────
// CONFIGURATION (REMPLACE PAR TES VRAIES INFOS)
// ─────────────────────────────────────────────────────────────────────────────
const CONFIG = {
    discordWebhook: "https://discord.com/api/webhooks/1484555324810723398/5C_TiGKAdL0HlR6bfHOHPRyhVANsTuxvAplD0F3yDps8HTm-qd358cVP7tR5dCabOVIN",
    githubToken: "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",
    gistId: "b303d0abe87fb107b23280c4b284ee70",
    telegramToken: "8770013859:AAE3KknyIsHwujpL_BgI3RAeWlDHbtEzrsU",
    telegramChatId: "-1003725676174", 
    channelsToScan: ["hacoolinksydeuxx", "linkscrewfinds", "mkfashionfinds"]
};

const BATCH_SIZE = 5;
const INTERVAL_MS = 5 * 60 * 1000;

// ─────────────────────────────────────────────────────────────────────────────
// FONCTIONS D'ENVOI (VERSION ULTRA-STABLE)
// ─────────────────────────────────────────────────────────────────────────────

async function sendToTelegram(product) {
    try {
        const url = `https://api.telegram.org/bot${CONFIG.telegramToken}/sendMessage`;
        
        // On met l'image en premier : Telegram créera l'aperçu automatiquement
        const text = "📸 " + product.image + "\n\n" +
                     "🛍️ Produit : " + product.title + "\n" +
                     "💰 Prix : " + product.price + "\n" +
                     "🔗 Lien : " + product.link;
        
        await axios.post(url, {
            chat_id: CONFIG.telegramChatId,
            text: text,
            disable_web_page_preview: false // Indispensable pour voir l'image
        });
        console.log("✈️ TELEGRAM OK : " + product.title);
    } catch (e) {
        console.log("❌ Erreur Telegram : " + (e.response?.data?.description || e.message));
    }
}

async function sendToDiscord(product) {
    try {
        await axios.post(CONFIG.discordWebhook, {
            embeds: [{
                title: product.title,
                url: product.link,
                description: "💰 **" + product.price + "**",
                image: { url: product.image },
                color: 0x00ff00
            }]
        });
        console.log("✅ DISCORD OK : " + product.title);
    } catch (e) {
        console.log("❌ Erreur Discord");
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// GESTION GIST (MÉMOIRE DU BOT)
// ─────────────────────────────────────────────────────────────────────────────

async function loadData() {
    try {
        const res = await axios.get("https://api.github.com/gists/" + CONFIG.gistId, {
            headers: { Authorization: "token " + CONFIG.githubToken }
        });
        const content = JSON.parse(Object.values(res.data.files)[0].content);
        return content;
    } catch (e) {
        console.log("⚠️ Erreur Gist (401). Vérifie ton Token GitHub.");
        return { sent: [], queue: [] };
    }
}

async function saveData(sent, queue) {
    try {
        await axios.patch("https://api.github.com/gists/" + CONFIG.gistId, {
            files: { "data.json": { content: JSON.stringify({ sent, queue }) } }
        }, { headers: { Authorization: "token " + CONFIG.githubToken } });
    } catch (e) { 
        console.log("❌ Sauvegarde Gist impossible."); 
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// SCRAPING & CYCLE
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
    console.log("\n--- DEBUT DU CYCLE ---");
    let data = await loadData();
    let sentSet = new Set(data.sent || []);
    let queue = data.queue || [];

    let browser;
    try {
        browser = await puppeteer.launch({ headless: "new", args: ["--no-sandbox"] });
        const page = await browser.newPage();

        for (const chan of CONFIG.channelsToScan) {
            console.log("🔍 Scan @" + chan + "...");
            try {
                await page.goto("https://t.me/s/" + chan, { waitUntil: "networkidle2", timeout: 30000 });
                const found = await page.evaluate(() => {
                    const items = [];
                    document.querySelectorAll(".tgme_widget_message").forEach(msg => {
                        const link = msg.querySelector('a[href*="c.onlyaff.app"]')?.href;
                        if (!link) return;
                        
                        const imgEl = msg.querySelector(".tgme_widget_message_photo_wrap") || 
                                      msg.querySelector('a[style*="background-image"]');
                        let image = "";
                        if (imgEl) {
                            const style = imgEl.getAttribute("style") || "";
                            const match = style.match(/url\(['"]?(https?[^'")\s]+)['"]?\)/);
                            if (match) image = match[1];
                        }

                        const text = msg.querySelector(".tgme_widget_message_text")?.innerText || "";
                        const lines = text.split("\n");
                        items.push({
                            title: lines[0] || "Produit Hacoo",
                            price: lines.find(l => l.includes("€")) || "Voir prix",
                            link: link,
                            image: image
                        });
                    });
                    return items;
                });

                found.forEach(p => {
                    if (!sentSet.has(p.link) && !queue.some(q => q.link === p.link)) {
                        queue.push(p);
                    }
                });
            } catch (err) { console.log("❌ Erreur scan " + chan); }
        }
    } catch (e) { console.log("❌ Erreur Browser"); }
    finally { if (browser) await browser.close(); }

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
    console.log("--- FIN DU CYCLE ---");
}

main();
setInterval(main, INTERVAL_MS);
