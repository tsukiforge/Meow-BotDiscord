const { Events, AuditLogEvent, PermissionFlagsBits } = require("discord.js");

const BOT_NAME = "MeowBot";
const DEVELOPER_NAME = "tsukiforge";
const REPO_URL = "https://github.com/tsukiforge/Meow-BotDiscord";
const ABOUT_TEXT = "MeowBot adalah bot Discord ringan yang dibuat untuk membantu server dengan fitur sederhana, friendly, dan mudah digunakan.";

const JOIN_FRESHNESS_MS = 60000;
const AUDIT_DELAY_MS = 1500;
const AUDIT_FRESHNESS_MS = 120000;

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(error) {
    return error?.message ?? String(error);
}

async function findInviter(client, guild, { logger = console, delayMs = AUDIT_DELAY_MS } = {}) {
    if (delayMs > 0) await sleep(delayMs);

    try {
        const logs = await guild.fetchAuditLogs({ type: AuditLogEvent.BotAdd, limit: 5 });
        const entry = logs.entries.find((item) =>
            item.target?.id === client.user?.id &&
            Date.now() - item.createdTimestamp < AUDIT_FRESHNESS_MS
        );
        if (entry?.executor) {
            logger.log(`[AUTODM] ${new Date().toISOString()} Penambah bot terdeteksi dari audit log: ${entry.executor.tag ?? entry.executor.id}`);
            return entry.executor;
        }
        logger.warn(`[AUTODM] ${new Date().toISOString()} Audit log tidak menemukan penambah bot untuk guild ${guild.id}; fallback ke owner`);
    } catch (error) {
        logger.warn(`[AUTODM] ${new Date().toISOString()} Gagal membaca audit log guild ${guild.id} (butuh izin View Audit Log?): ${errorMessage(error)}`);
    }

    try {
        const owner = await guild.fetchOwner();
        if (owner?.user) {
            logger.log(`[AUTODM] ${new Date().toISOString()} Menggunakan owner server sebagai penerima DM: ${owner.user.tag ?? owner.user.id}`);
            return owner.user;
        }
    } catch (error) {
        logger.warn(`[AUTODM] ${new Date().toISOString()} Gagal mengambil owner guild ${guild.id}: ${errorMessage(error)}`);
    }

    try {
        const ownerUser = await client.users.fetch(guild.ownerId);
        if (ownerUser) {
            logger.log(`[AUTODM] ${new Date().toISOString()} Menggunakan owner server (fetch) sebagai penerima DM: ${ownerUser.tag ?? ownerUser.id}`);
            return ownerUser;
        }
    } catch (error) {
        logger.warn(`[AUTODM] ${new Date().toISOString()} Gagal fetch user owner guild ${guild.id}: ${errorMessage(error)}`);
    }

    logger.warn(`[AUTODM] ${new Date().toISOString()} Tidak menemukan penerima DM untuk guild ${guild.name ?? guild.id}`);
    return null;
}

function buildInstallMessage(recipientName, guildName) {
    const displayName = recipientName ? `, ${recipientName}` : "";
    return [
        `Halo${displayName}! Meow~ 🐾`,
        ``,
        `Terima kasih sudah install **${BOT_NAME}** di server **${guildName}**.`,
        ``,
        `Saya, **${DEVELOPER_NAME}**, developer dari bot ini, ingin mengucapkan terima kasih atas kepercayaannya.`,
        ``,
        `**${BOT_NAME}** dibuat untuk membantu server kamu tetap hidup, rapi, dan nyaman dengan fitur yang sederhana tapi berguna.`,
        ``,
        `Untuk mulai menggunakan bot, kamu bisa coba command berikut:`,
        `- /join`,
        `- /help`,
        `- /ping`,
        `- /move <nama channel>`,
        `- /say @user text`,
        `- /status`,
        `- /about`,
        `- /leave`,
        `- /game`,
        ``,
        `**Tentang bot:**`,
        `${ABOUT_TEXT}`,
        ``,
        `**Repository / source code:**`,
        `${REPO_URL}`,
        ``,
        `Kalau kamu butuh bantuan, mau request fitur, atau mau lihat update terbaru, silakan hubungi saya melalui Discord developer ini.`,
        ``,
        `Semoga **${BOT_NAME}** bermanfaat untuk server kamu. Meow~`,
        ``,
        `Salam hangat,`,
        `**${DEVELOPER_NAME}**`,
        `Developer ${BOT_NAME}`
    ].join("\n");
}

async function sendInstallDM(client, guild, inviter) {
    const recipient = inviter ?? null;
    const message = buildInstallMessage(recipient?.globalName ?? recipient?.username ?? null, guild.name);

    if (recipient?.send) {
        try {
            await recipient.send({ content: message });
            console.log(`[AUTODM] ${new Date().toISOString()} DM install terkirim ke ${recipient.tag ?? recipient.id} untuk server ${guild.name}`);
            return true;
        } catch (error) {
            if (error?.code === 50007) {
                console.warn(`[AUTODM] ${new Date().toISOString()} DM tertutup untuk ${recipient.tag ?? recipient.id}; fallback ke system channel`);
            } else {
                console.warn(`[AUTODM] ${new Date().toISOString()} Gagal kirim DM ke ${recipient.tag ?? recipient.id}: ${errorMessage(error)}`);
            }
        }
    }

    try {
        const systemChannel = guild.systemChannel;
        const canSend = systemChannel &&
            systemChannel.permissionsFor(client.user)?.has(PermissionFlagsBits.SendMessages);
        if (canSend) {
            await systemChannel.send({ content: message });
            console.log(`[AUTODM] ${new Date().toISOString()} DM gagal; pesan terkirim ke system channel server ${guild.name}`);
            return true;
        }
        console.warn(`[AUTODM] ${new Date().toISOString()} Tidak ada jalur pengiriman pesan untuk server ${guild.name}`);
    } catch (error) {
        console.warn(`[AUTODM] ${new Date().toISOString()} Gagal kirim ke system channel server ${guild.name}: ${errorMessage(error)}`);
    }

    return false;
}

function registerInstallDM(client, { onGuildJoin } = {}) {
    client.on(Events.GuildCreate, async (guild) => {
        try {
            if (guild.joinedTimestamp && Date.now() - guild.joinedTimestamp > JOIN_FRESHNESS_MS) {
                return;
            }

            if (typeof onGuildJoin === "function") {
                try {
                    await onGuildJoin(guild);
                } catch (error) {
                    console.error(`[AUTODM] ${new Date().toISOString()} Registrasi guild ${guild?.name ?? guild?.id} gagal: ${errorMessage(error)}`);
                }
            }

            let inviter = null;
            try {
                inviter = await findInviter(client, guild);
            } catch (error) {
                console.error(`[AUTODM] ${new Date().toISOString()} Pencarian inviter guild ${guild?.name ?? guild?.id} gagal: ${errorMessage(error)}`);
            }

            try {
                await sendInstallDM(client, guild, inviter);
            } catch (error) {
                console.error(`[AUTODM] ${new Date().toISOString()} Pengiriman DM install guild ${guild?.name ?? guild?.id} gagal: ${errorMessage(error)}`);
            }
        } catch (error) {
            console.error(`[AUTODM] ${new Date().toISOString()} Gagal memproses guild baru ${guild?.name ?? guild?.id}: ${errorMessage(error)}`);
        }
    });
}

module.exports = { registerInstallDM, findInviter, buildInstallMessage };
