const puppeteer = require("puppeteer");
const axios = require("axios");

// ─────────────────────────────────────────────────────────────────────────────
// CONFIGURATION (REMPLACE LES VALEURS ENTRE GUILLEMETS)
// ─────────────────────────────────────────────────────────────────────────────
const CONFIG = {
    discordWebhook: "https://discord.com/api/webhooks/1484555324810723398/5C_TiGKAdL0HlR6bfHOHPRyhVANsTuxvAplD0F3yDps8HTm-qd358cVP7tR5dCabOVIN",
    githubToken: "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",
    gistId: "b303d0abe87fb107b23280c4b284ee70",
    telegramToken: "8770013859:AAE3KknyIsHwujpL_BgI3RAeWlDHbtEzrsU",
    telegramChatId: "-1003725676174", 
    channelsToScan: ["hacoolinksydeuxx", "linkscrewfinds", "mkfashionfinds"]
};

const BATCH_SIZE = 5; // Nombre de produits envoyés par cycle
const INTERVAL_MS = 5 * 60 * 1000; // Scan toutes les 5 minutes

// ─────────────────────────────────────────────────────────────────────────────
// FONCTIONS D'ENVOI
// ─────────────────────────────────────────────────────────────────────────────

async function sendToTelegram(product) {
    try {
        const url = `https://api.telegram.org/bot${CONFIG.telegramToken}/sendPhoto`;
        
        // On envoie une vraie photo avec une légende (caption)
        await axios.post(url, {
            chat_id: CONFIG.telegramChatId,
            photo: product.image || "https://placehold.co/600x400?text=Hacoo+Deals",
            caption: "🛍️ " + product.title + "\n💰 " + product.price + "\n🔗 " + product.link
        });
        console.log("✈️ TELEGRAM OK : " + product.title);
    } catch (e) {
        console.log("⚠️ Echec photo Telegram, tentative en texte simple...");
        try {
            const txtUrl = `https://api.telegram.org/bot${CONFIG.telegramToken}/sendMessage`;
            await axios.post(txtUrl, {
                chat_id: CONFIG.telegramChatId,
                text: "🛍️ " + product.title + "\n💰 " + product.price + "\n🔗 " + product.link + "\n📸 " + product.image
            });
        } catch (err) {
            console.log("❌ Erreur Telegram totale : " + (err.response?.data?.description || err.message));
        }
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
// GESTION DE LA MÉMOIRE (GIST)
// ─────────────────────────────────────────────────────────────────────────────

async function loadData() {
    try {
        const res = await axios.get("https://api.github.com/gists/" + CONFIG.gistId, {
            headers: { Authorization: "token " + CONFIG.githubToken }
        });
        const content = JSON.parse(Object.values(res.data.files)[0].content);
        return content;
    } catch (e) {
        console.log("⚠️ Erreur Gist (" + (e.response?.status || "Inconnu") + "). Le bot va renvoyer les anciens produits.");
        return { sent: [], queue: [] };
    }
}

async function saveData(sent, queue) {
    try {
        // On ne garde que les 200 derniers liens pour ne pas faire exploser le Gist
        const limitedSent = sent.slice(-200);
        await axios.patch("https://api.github.com/gists/" + CONFIG.gistId, {
            files: { "data.json": { content: JSON.stringify({ sent: limitedSent, queue }) } }
        }, { headers: { Authorization: "token " + CONFIG.githubToken } });
        console.log("💾 Mémoire sauvegardée.");
    } catch (e) { 
        console.log("❌ Sauvegarde Gist échouée. Vérifie tes permissions Token (Gist)."); 
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// SCRAPING & LOGIQUE PRINCIPALE
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
            console.log("🔍 Scan @" + chan + "...");
            try {
                await page.goto("https://t.me/s/" + chan, { waitUntil: "networkidle2", timeout: 30000 });
                
                const found = await page.evaluate(() => {
                    const items = [];
                    document.querySelectorAll(".tgme_widget_message").forEach(msg => {
                        const link = msg.querySelector('a[href*="c.onlyaff.app"]')?.href;
                        if (!link) return;
                        
                        // Extraction de l'image
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
                            title: lines[0]?.substring(0, 100) || "Produit Hacoo",
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
    } catch (e) { console.log("❌ Erreur Browser : " + e.message); }
    finally { if (browser) await browser.close(); }

    // Envoi des nouveaux produits
    if (queue.length > 0) {
        console.log("📦 Produits en attente : " + queue.length);
        const toSend = queue.splice(0, BATCH_SIZE);
        for (const product of toSend) {
            await sendToDiscord(product);
            await sendToTelegram(product);
            sentSet.add(product.link);
            await new Promise(r => setTimeout(r, 3000)); // Pause pour éviter le spam
        }
    } else {
        console.log("✨ Rien de nouveau à envoyer.");
    }

    await saveData([...sentSet], queue);
    console.log("--- FIN DU CYCLE ---");
}

// Lancement
main();
setInterval(main, INTERVAL_MS);
