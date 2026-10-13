require("dotenv").config();

const {
    Client,
    GatewayIntentBits,
    Events,
    ChannelType
} = require("discord.js");
const { VoiceManager } = require("./voice-manager");

const BOT_NAME = "MeowBot";
const DEVELOPER_NAME = "tsukiforge";
const REPO_URL = "https://github.com/tsukiforge/Meow-BotDiscord";
const ABOUT_TEXT = "MeowBot adalah bot Discord ringan yang dibuat untuk membantu server dengan fitur sederhana, friendly, dan mudah digunakan.";
const MAX_GAME_ROOM_PLAYERS = 6;
const AUTO_REJOIN_ON_START = process.env.AUTO_REJOIN_ON_START !== "false";
const gameRooms = new Map();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates
    ]
});

const voiceManager = new VoiceManager(client);

function findVoiceChannel(guild, channelName) {
    const target = String(channelName || "").trim();

    if (!target) return null;

    return guild.channels.cache.find((channel) => {
        if (channel.type !== ChannelType.GuildVoice) return false;

        const name = channel.name.toLowerCase();
        const query = target.toLowerCase();

        return name === query || name.includes(query);
    }) || null;
}

function generateRoomCode() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code = "";

    for (let i = 0; i < 5; i += 1) {
        code += chars[Math.floor(Math.random() * chars.length)];
    }

    return code;
}

function getRoomByCode(code) {
    const normalizedCode = String(code || "").trim().toUpperCase();
    if (!normalizedCode) return null;

    return gameRooms.get(normalizedCode) ?? null;
}

client.once(Events.ClientReady, async (bot) => {
    console.log(`[BOT] ${new Date().toISOString()} online sebagai ${bot.user.tag}`);
    await voiceManager.restoreTargets({ autoReconnect: AUTO_REJOIN_ON_START });
});

client.on(Events.ShardDisconnect, (event, shardId) => {
    console.warn(`[GATEWAY] ${new Date().toISOString()} shard ${shardId} terputus (code ${event.code})`);
});
client.on(Events.ShardReconnecting, (shardId) => {
    console.warn(`[GATEWAY] ${new Date().toISOString()} shard ${shardId} mencoba tersambung kembali`);
});
client.on(Events.ShardResume, (shardId, replayedEvents) => {
    console.log(`[GATEWAY] ${new Date().toISOString()} shard ${shardId} pulih; replay ${replayedEvents} event`);
});
client.on(Events.Error, (error) => {
    console.error(`[ERROR] ${new Date().toISOString()} Discord client: ${error?.message ?? String(error)}`);
});
client.on(Events.ChannelDelete, (channel) => {
    voiceManager.onChannelDeleted(channel).catch((error) => {
        console.error(`[ERROR] ${new Date().toISOString()} validasi channel terhapus: ${error?.message ?? String(error)}`);
    });
});
client.on(Events.ChannelUpdate, (_oldChannel, channel) => {
    voiceManager.onChannelUpdated(channel).catch((error) => {
        console.error(`[ERROR] ${new Date().toISOString()} validasi perubahan channel: ${error?.message ?? String(error)}`);
    });
});
client.on(Events.GuildMemberUpdate, (_oldMember, member) => {
    if (member.id !== client.user?.id) return;
    voiceManager.onGuildMemberUpdated(member.guild.id).catch((error) => {
        console.error(`[ERROR] ${new Date().toISOString()} validasi izin bot: ${error?.message ?? String(error)}`);
    });
});
client.on(Events.GuildDelete, (guild) => {
    voiceManager.onGuildDeleted(guild.id).catch((error) => {
        console.error(`[ERROR] ${new Date().toISOString()} penghapusan target guild: ${error?.message ?? String(error)}`);
    });
});

client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const guildId = interaction.guildId;

    if (!guildId) {
        return interaction.reply({
            content: "❌ Command ini hanya bisa digunakan di server.",
            ephemeral: true
        });
    }

    if (interaction.commandName === "help") {
        return interaction.reply({
            content: [
                "📘 **Daftar command Bot Meow**",
                "- `/join` — masuk ke voice channel tempatmu saat ini",
                "- `/help` — lihat daftar command",
                "- `/ping` — cek respon bot",
                "- `/move <nama channel>` — pindahkan bot ke voice channel tertentu",
                "- `/say @user text` — mention user lalu kirim teks",
                "- `/status` — cek channel bot saat ini",
                "- `/about` — lihat info bot dan repo",
                "- `/leave` — keluar dari voice channel",
                "- `/game [kode]` — buat atau join room game"
            ].join("\n"),
            ephemeral: true
        });
    }

    if (interaction.commandName === "ping") {
        return interaction.reply({
            content: "🏓 Pong! Bot masih hidup.",
            ephemeral: true
        });
    }

    if (interaction.commandName === "about") {
        return interaction.reply({
            content: [
                `🐾 **${BOT_NAME}**`,
                "",
                `**Developer:** ${DEVELOPER_NAME}`,
                `**Repo:** ${REPO_URL}`,
                "",
                ABOUT_TEXT,
                "",
                "**Command utama:** `/join`, `/help`, `/ping`, `/move`, `/status`, `/say`, `/about`, `/leave`"
            ].join("\n"),
            ephemeral: true
        });
    }

    if (interaction.commandName === "join") {
        const currentChannel = interaction.member?.voice?.channel;

        if (!currentChannel || currentChannel.type !== ChannelType.GuildVoice) {
            return interaction.reply({
                content: "❌ Meow~ kamu belum berada di Voice Channel. Masuk ke channel voice lalu jalankan `/join` lagi.",
                ephemeral: true
            });
        }

        try {
            await interaction.deferReply({ ephemeral: true });
            const result = await voiceManager.setTarget(guildId, currentChannel.id);
            if (result.invalid) {
                await interaction.editReply("❌ Bot tidak dapat melihat atau bergabung ke channel itu. Target standby dibatalkan.");
            } else {
                await interaction.editReply(result.ready
                    ? `🐱 Meow~ standby di **${currentChannel.name}**.`
                    : `⚠️ Meow~ belum berhasil tersambung ke **${currentChannel.name}**. Target tersimpan; jalankan /join lagi untuk mencoba.`);
            }
        } catch (error) {
            console.error(`[ERROR] ${new Date().toISOString()} /join guild ${guildId}: ${error?.message ?? String(error)}`);
            if (interaction.deferred) await interaction.editReply("❌ Meow~ gagal masuk ke Voice Channel.");
            else await interaction.reply({ content: "❌ Meow~ gagal masuk ke Voice Channel.", ephemeral: true });
        }

        return;
    }

    if (interaction.commandName === "move") {
        const channelName = interaction.options.getString("channel");
        const targetChannel = findVoiceChannel(interaction.guild, channelName);

        if (!targetChannel) {
            return interaction.reply({
                content: `❌ Channel **${channelName}** tidak ditemukan di server ini.`,
                ephemeral: true
            });
        }

        try {
            await interaction.deferReply({ ephemeral: true });
            const result = await voiceManager.setTarget(guildId, targetChannel.id);
            if (result.invalid) {
                await interaction.editReply("❌ Bot tidak dapat melihat atau bergabung ke channel itu. Target standby dibatalkan.");
            } else {
                await interaction.editReply(result.ready
                    ? `🐱 Meow~ standby di **${targetChannel.name}**.`
                    : `⚠️ Meow~ belum berhasil tersambung ke **${targetChannel.name}**. Target diperbarui; jalankan /move lagi untuk mencoba.`);
            }
            console.log(`[TARGET] ${new Date().toISOString()} /move: ${targetChannel.name} (${guildId})`);
        } catch (error) {
            console.error(`[ERROR] ${new Date().toISOString()} /move guild ${guildId}: ${error?.message ?? String(error)}`);
            if (interaction.deferred) await interaction.editReply("❌ Meow~ gagal pindah ke channel voice.");
            else await interaction.reply({ content: "❌ Meow~ gagal pindah ke channel voice.", ephemeral: true });
        }

        return;
    }

    if (interaction.commandName === "leave") {
        await voiceManager.leave(guildId);
        await interaction.reply("👋 Meow~ sudah keluar dari Voice Channel.");
        return;
    }

    if (interaction.commandName === "say") {
        const targetUser = interaction.options.getUser("user");
        const text = interaction.options.getString("text");

        if (!targetUser || !text) {
            return interaction.reply({
                content: "❌ Gunakan format `/say @user text` dengan user dan teks yang valid.",
                ephemeral: true
            });
        }

        await interaction.reply({
            content: `${targetUser} ${text}`,
            allowedMentions: {
                parse: [],
                users: [targetUser.id]
            }
        });

        return;
    }

    if (interaction.commandName === "status") {
        const status = voiceManager.status(guildId);
        if (status.state === "no-target") {
            return interaction.reply({ content: "⚪ Meow~ tidak memiliki target standby.", ephemeral: true });
        }
        const channel = interaction.guild.channels.cache.get(status.channelId);
        const label = {
            ready: "🟢 Terhubung dan Ready",
            connecting: "🟠 Sedang menyambung atas command manual",
            failed: "🔴 Terputus/gagal; jalankan /join untuk menyambungkan",
            disconnected: "🔴 Terputus"
        }[status.state];
        return interaction.reply({
            content: `${label}\n📡 Status koneksi: **${status.connectionStatus}**\n🎙️ Target: **${channel?.name ?? status.channelId}**\n🛠️ Percobaan manual berjalan: **${status.connecting ? "Ya" : "Tidak"}**${status.lastError ? `\n⚠️ Keterangan: ${status.lastError}` : ""}`,
            ephemeral: true
        });
    }

    if (interaction.commandName === "game") {
        const lobbyCode = interaction.options.getString("code")?.trim().toUpperCase();
        const userId = interaction.user.id;

        const currentRoom = [...gameRooms.values()].find((room) => room.guildId === guildId && room.players.has(userId));

        if (!lobbyCode) {
            if (currentRoom) {
                return interaction.reply({
                    content: `🎮 Kamu sudah ada di room **${currentRoom.code}**. Gunakan /game code:${currentRoom.code} untuk melihat statusnya.`,
                    ephemeral: true
                });
            }

            let newCode = generateRoomCode();
            while (gameRooms.has(newCode)) {
                newCode = generateRoomCode();
            }

            const room = {
                code: newCode,
                guildId,
                players: new Set([userId]),
                createdBy: interaction.user.id
            };

            gameRooms.set(newCode, room);

            return interaction.reply({
                content: `🎮 Room game baru berhasil dibuat!\nKode room: **${newCode}**\nAda 1/6 pemain di room ini.\nGunakan /game code:${newCode} untuk join room.`,
                allowedMentions: { parse: [] }
            });
        }

        const targetRoom = getRoomByCode(lobbyCode);

        if (!targetRoom) {
            return interaction.reply({
                content: `❌ Room dengan kode **${lobbyCode}** tidak ditemukan. Buat room baru dengan /game`,
                ephemeral: true
            });
        }

        if (targetRoom.guildId !== guildId) {
            return interaction.reply({
                content: "❌ Kode room ini bukan untuk server ini.",
                ephemeral: true
            });
        }

        if (targetRoom.players.has(userId)) {
            return interaction.reply({
                content: `🎮 Kamu sudah masuk ke room **${targetRoom.code}**.`,
                ephemeral: true
            });
        }

        if (targetRoom.players.size >= MAX_GAME_ROOM_PLAYERS) {
            return interaction.reply({
                content: `❌ Room **${targetRoom.code}** sudah penuh (maksimal ${MAX_GAME_ROOM_PLAYERS} pemain).`,
                ephemeral: true
            });
        }

        targetRoom.players.add(userId);

        return interaction.reply({
            content: `✅ Kamu berhasil join room **${targetRoom.code}**.\nJumlah pemain: **${targetRoom.players.size}/${MAX_GAME_ROOM_PLAYERS}**`,
            allowedMentions: { parse: [] }
        });
    }
});

let shuttingDown = false;
async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[BOT] ${new Date().toISOString()} menerima ${signal}; shutdown dimulai`);
    await voiceManager.close();
    client.destroy();
    console.log(`[BOT] ${new Date().toISOString()} shutdown selesai`);
}

process.once("SIGINT", () => shutdown("SIGINT").catch((error) => {
    console.error(`[ERROR] ${new Date().toISOString()} shutdown SIGINT: ${error?.message ?? String(error)}`);
    process.exitCode = 1;
}));
process.once("SIGTERM", () => shutdown("SIGTERM").catch((error) => {
    console.error(`[ERROR] ${new Date().toISOString()} shutdown SIGTERM: ${error?.message ?? String(error)}`);
    process.exitCode = 1;
}));

console.log(`[BOT] ${new Date().toISOString()} memulai proses utama`);
if (!process.env.DISCORD_TOKEN) {
    console.error(`[ERROR] ${new Date().toISOString()} DISCORD_TOKEN tidak diatur`);
    process.exitCode = 1;
} else {
    client.login(process.env.DISCORD_TOKEN).then(() => {
        console.log(`[BOT] ${new Date().toISOString()} login Discord berhasil`);
    }).catch((error) => {
        console.error(`[ERROR] ${new Date().toISOString()} login Discord gagal: ${error?.message ?? String(error)}`);
        process.exitCode = 1;
    });
}
