const puppeteer = require("puppeteer");
const axios = require("axios");

// ─────────────────────────────────────────────────────────────────────────────
// CONFIGURATION (VÉRIFIE BIEN TON GITHUB_TOKEN ET TON GIST_ID)
// ─────────────────────────────────────────────────────────────────────────────
const CONFIG = {
    discordWebhook: "https://discord.com/api/webhooks/1484555324810723398/5C_TiGKAdL0HlR6bfHOHPRyhVANsTuxvAplD0F3yDps8HTm-qd358cVP7tR5dCabOVIN",
    githubToken: "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",
    gistId: "b303d0abe87fb107b23280c4b284ee70",
    telegramToken: "8770013859:AAE3KknyIsHwujpL_BgI3RAeWlDHbtEzrsU",
    telegramChatId: "-1003725676174", 
    channelsToScan: ["hacoolinksydeuxx", "linkscrewfinds", "mkfashionfinds"]
};

// ─────────────────────────────────────────────────────────────────────────────
// FONCTIONS D'ENVOI
// ─────────────────────────────────────────────────────────────────────────────

async function sendToTelegram(product) {
    try {
        // On utilise l'URL de l'image directement dans le message pour Telegram
        const url = `https://api.telegram.org/bot${CONFIG.telegramToken}/sendMessage`;
        const text = `📸 ${product.image}\n\n🛍️ **${product.title}**\n💰 **${product.price}**\n\n🔗 [VOIR LE PRODUIT](${product.link})`;
        
        await axios.post(url, {
            chat_id: CONFIG.telegramChatId,
            text: text,
            parse_mode: "Markdown"
        });
        console.log(`✈️ TELEGRAM OK: ${product.title}`);
    } catch (e) {
        console.log(`❌ Erreur Telegram: ${e.response?.data?.description || e.message}`);
    }
}

async function sendToDiscord(product) {
    try {
        await axios.post(CONFIG.discordWebhook, {
            embeds: [{
                title: product.title,
                url: product.link,
                description: `💰 **${product.price}**`,
                image: { url: product.image },
                color: 0x00ff00
            }]
        });
        console.log(`✅ DISCORD OK: ${product.title}`);
    } catch (e) { console.log("❌ Erreur Discord"); }
}

// ─────────────────────────────────────────────────────────────────────────────
// COEUR DU BOT
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
    console.log("\n--- DEBUT DU CYCLE ---");
    
    let browser;
    try {
        browser = await puppeteer.launch({ headless: "new", args: ["--no-sandbox"] });
        const page = await browser.newPage();
        
        for (const chan of CONFIG.channelsToScan) {
            console.log(`🔍 Scan @${chan}...`);
            await page.goto(`https://t.me/s/${chan}`, { waitUntil: "networkidle2" });
            
            const products = await page.evaluate(() => {
                const results = [];
                document.querySelectorAll(".tgme_widget_message").forEach(msg => {
                    const link = msg.querySelector('a[href*="c.onlyaff.app"]')?.href;
                    if (!link) return;
                    
                    // Récupération de l'image via le style background-image
                    const imgEl = msg.querySelector(".tgme_widget_message_photo_wrap") || 
                                  msg.querySelector('a[style*="background-image"]');
                    let image = "";
                    if (imgEl) {
                        const style = imgEl.getAttribute("style") || "";
                        const match = style.match(/url\(['"]?(https?[^'")\s]+)['"]?\)/);
                        if (match) image = match[1];
                    }

                    const text = msg.querySelector(".tgme_widget_message_text")?.innerText || "";
                    results.push({
                        title: text.split("\n")[0] || "Produit Hacoo",
                        price: text.match(/\d+€/) ? text.match(/\d+€/)[0] : "Voir prix",
                        link: link,
                        image: image
                    });
                });
                return results;
            });

            // On envoie les 2 derniers produits trouvés pour tester
            const toSend = products.slice(-2); 
            for (const p of toSend) {
                await sendToDiscord(p);
                await sendToTelegram(p);
                await new Promise(r => setTimeout(r, 2000));
            }
        }
    } catch (e) {
        console.log("❌ Erreur Scraping:", e.message);
    } finally {
        if (browser) await browser.close();
        console.log("--- FIN DU CYCLE ---");
    }
}

main();
setInterval(main, 10 * 60 * 1000); // Toutes les 10 minutes
