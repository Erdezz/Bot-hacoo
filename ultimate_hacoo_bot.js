const puppeteer = require("puppeteer");
const axios = require("axios");

// ─────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────
const CONFIG = {
    discordWebhook: "https://discord.com/api/webhooks/1484555324810723398/5C_TiGKAdL0HlR6bfHOHPRyhVANsTuxvAplD0F3yDps8HTm-qd358cVP7tR5dCabOVIN",
    githubToken: "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 ", // ⚠️ PAS D'ESPACE !
    gistId: "b303d0abe87fb107b23280c4b284ee70",
    telegramToken: "8770013859:AAE3KknyIsHwujpL_BgI3RAeWlDHbtEzrsU",
    telegramChatId: "@Erdezz",
    channelsToScan: ["hacoolinksydeuxx", "linkscrewfinds", "mkfashionfinds"]
};

const BATCH_SIZE = 5;
const INTERVAL_MS = 5 * 60 * 1000;

// ─────────────────────────────────────────────────────────
// TELEGRAM
// ─────────────────────────────────────────────────────────
async function sendToTelegram(product) {
    try {
        const url = `https://api.telegram.org/bot${CONFIG.telegramToken}/sendPhoto`;

        const image = (!product.image || product.image.includes("blob"))
            ? "https://placehold.co/600x400?text=Hacoo+Deals"
            : product.image;

        await axios.post(url, {
            chat_id: CONFIG.telegramChatId,
            photo: image,
            caption:
                "🛍️ " + product.title +
                "\n💰 " + product.price +
                "\n🔗 " + product.link
        });

        console.log("✈️ TELEGRAM OK :", product.title);
    } catch (e) {
        console.log("⚠️ Fallback Telegram texte");

        try {
            await axios.post(
                `https://api.telegram.org/bot${CONFIG.telegramToken}/sendMessage`,
                {
                    chat_id: CONFIG.telegramChatId,
                    text:
                        "🛍️ " + product.title +
                        "\n💰 " + product.price +
                        "\n🔗 " + product.link
                }
            );
        } catch (err) {
            console.log("❌ Telegram ERROR :", err.message);
        }
    }
}

// ─────────────────────────────────────────────────────────
// DISCORD
// ─────────────────────────────────────────────────────────
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

        console.log("✅ DISCORD OK :", product.title);
    } catch (e) {
        console.log("❌ Discord ERROR");
    }
}

// ─────────────────────────────────────────────────────────
// GIST (MEMOIRE)
// ─────────────────────────────────────────────────────────
async function loadData() {
    try {
        const res = await axios.get(
            "https://api.github.com/gists/" + CONFIG.gistId,
            { headers: { Authorization: "token " + CONFIG.githubToken } }
        );

        const content = JSON.parse(
            Object.values(res.data.files)[0].content
        );

        console.log("📂 Mémoire chargée :", content.sent.length);

        return content;
    } catch (e) {
        console.log("⚠️ Gist erreur → reset mémoire");
        return { sent: [], queue: [] };
    }
}

async function saveData(sent, queue) {
    try {
        await axios.patch(
            "https://api.github.com/gists/" + CONFIG.gistId,
            {
                files: {
                    "data.json": {
                        content: JSON.stringify({
                            sent: sent.slice(-200),
                            queue
                        })
                    }
                }
            },
            { headers: { Authorization: "token " + CONFIG.githubToken } }
        );

        console.log("💾 Sauvegarde OK");
    } catch (e) {
        console.log("❌ Gist save ERROR");
    }
}

// ─────────────────────────────────────────────────────────
// SCRAPING
// ─────────────────────────────────────────────────────────
async function scrapeChannel(page, chan) {
    console.log("🔍 Scan @" + chan);

    await page.goto(`https://t.me/s/${chan}`, {
        waitUntil: "networkidle2",
        timeout: 30000
    });

    return await page.evaluate(() => {
        const items = [];

        document.querySelectorAll(".tgme_widget_message").forEach(msg => {
            const link = msg.querySelector('a[href*="c.onlyaff.app"]')?.href;
            if (!link) return;

            // IMAGE FIX
            let image = "";

            const photo = msg.querySelector(".tgme_widget_message_photo_wrap");
            if (photo) {
                const style = photo.style.backgroundImage;
                const match = style.match(/url\(["']?(.*?)["']?\)/);
                if (match) image = match[1];
            }

            if (!image) {
                const imgTag = msg.querySelector("img");
                if (imgTag) image = imgTag.src;
            }

            const text =
                msg.querySelector(".tgme_widget_message_text")?.innerText || "";

            const lines = text.split("\n");

            items.push({
                title: lines[0]?.slice(0, 100) || "Produit",
                price: lines.find(l => l.includes("€")) || "Voir prix",
                link,
                image
            });
        });

        return items;
    });
}

// ─────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────
async function main() {
    console.log("\n--- 🚀 NOUVEAU CYCLE ---");

    const data = await loadData();

    const sentSet = new Set(data.sent || []);
    const queue = data.queue || [];

    let browser;

    try {
        browser = await puppeteer.launch({
            headless: "new",
            args: ["--no-sandbox"]
        });

        const page = await browser.newPage();

        for (const chan of CONFIG.channelsToScan) {
            try {
                const products = await scrapeChannel(page, chan);

                products.forEach(p => {
                    const id = p.link + p.title;

                    if (
                        !sentSet.has(id) &&
                        !queue.some(q => q.link === p.link)
                    ) {
                        queue.push({ ...p, id });
                    }
                });
            } catch {
                console.log("❌ erreur channel", chan);
            }
        }
    } catch (e) {
        console.log("❌ Browser ERROR", e.message);
    } finally {
        if (browser) await browser.close();
    }

    // ENVOI
    if (queue.length > 0) {
        console.log("📦 A envoyer :", queue.length);

        const toSend = queue.splice(0, BATCH_SIZE);

        for (const product of toSend) {
            await sendToDiscord(product);
            await sendToTelegram(product);

            sentSet.add(product.id);

            await new Promise(r => setTimeout(r, 2000));
        }
    } else {
        console.log("✨ Rien de nouveau");
    }

    await saveData([...sentSet], queue);

    console.log("--- FIN ---");
}

// ─────────────────────────────────────────────────────────
main();
setInterval(main, INTERVAL_MS);
