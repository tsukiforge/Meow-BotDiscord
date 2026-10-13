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
    try {
        console.log(`[BOT] ${new Date().toISOString()} online sebagai ${bot.user.tag}`);
        await voiceManager.restoreTargets({ autoReconnect: AUTO_REJOIN_ON_START });
    } catch (error) {
        console.error(`[ERROR] ${new Date().toISOString()} startup voice recovery gagal: ${error?.message ?? String(error)}`);
    }
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
client.on(Events.Warn, (message) => {
    console.warn(`[WARN] ${new Date().toISOString()} Discord client: ${message}`);
});
client.on(Events.ShardError, (error, shardId) => {
    console.error(`[ERROR] ${new Date().toISOString()} shard ${shardId} error: ${error?.message ?? String(error)}`);
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
            content: "Mmm... command ini hanya bisa dipakai di server ya, Meow~",
            ephemeral: true
        });
    }

    if (interaction.commandName === "help") {
        return interaction.reply({
            content: [
                "🐾 **Mmm... ini semua command Meow~**",
                "- `/join` — Meow masuk ke voice channel kamu",
                "- `/help` — lihat daftar command ini lagi",
                "- `/ping` — cek apakah Meow masih menyala",
                "- `/move <nama channel>` — pindahkan Meow ke voice channel lain",
                "- `/say @user text` — kirim pesan untuk user tertentu",
                "- `/status` — cek kondisi koneksi Meow",
                "- `/about` — lihat info MeowBot",
                "- `/leave` — minta Meow keluar dari voice channel",
                "- `/game [kode]` — buat atau join room game"
            ].join("\n"),
            ephemeral: true
        });
    }

    if (interaction.commandName === "ping") {
        return interaction.reply({
            content: "🏓 Pong~ Meow masih menyala dan siap membantu!",
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
                "**Command utama:** `/join`, `/help`, `/ping`, `/move`, `/status`, `/say`, `/about`, `/leave`, `/game`"
            ].join("\n"),
            ephemeral: true
        });
    }

    if (interaction.commandName === "join") {
        let currentChannel = interaction.member?.voice?.channel ?? null;
        try {
            const member = await interaction.guild.members.fetch(interaction.user.id);
            currentChannel = member.voice?.channel ?? null;
        } catch (error) {
            console.warn(`[WARN] ${new Date().toISOString()} gagal mengambil voice state user ${interaction.user.id}: ${error?.message ?? String(error)}`);
        }

        if (!currentChannel || currentChannel.type !== ChannelType.GuildVoice) {
            return interaction.reply({
                content: "Eh~ Meow belum melihat kamu di Voice Channel. Masuk dulu ke channel voice, lalu coba `/join` lagi ya.",
                ephemeral: true
            });
        }

        const currentStatus = voiceManager.status(guildId);
        if (currentStatus.state === "ready" && currentStatus.channelId === currentChannel.id) {
            return interaction.reply({
                content: `Mmm... kamu nggak lihat Meow ya? Meow sudah di sini, di **${currentChannel.name}**~ Jangan `/join` lagi, santai saja!`,
                ephemeral: true
            });
        }

        try {
            await interaction.reply({
                content: "Mmm... Meow sedang masuk ke Voice Channel, tunggu sebentar ya~",
                ephemeral: true
            });
            const result = await voiceManager.setTarget(guildId, currentChannel.id);
            if (result.invalid) {
                await interaction.editReply("Aduh~ Meow tidak bisa melihat atau masuk ke channel itu. Target standby dibatalkan ya.");
            } else {
                await interaction.editReply(result.ready
                    ? `Yay~ Meow sudah join dan standby di **${currentChannel.name}**!`
                    : `Hmm... Meow belum berhasil masuk ke **${currentChannel.name}**. Target sudah disimpan dan Meow akan mencoba recovery lagi.`);
            }
        } catch (error) {
            console.error(`[ERROR] ${new Date().toISOString()} /join guild ${guildId}: ${error?.message ?? String(error)}`);
            if (interaction.replied || interaction.deferred) await interaction.editReply("Aduh~ Meow gagal masuk ke Voice Channel. Coba `/join` lagi ya.");
            else await interaction.reply({ content: "Aduh~ Meow gagal masuk ke Voice Channel. Coba `/join` lagi ya.", ephemeral: true });
        }

        return;
    }

    if (interaction.commandName === "move") {
        const channelName = interaction.options.getString("channel");
        const targetChannel = findVoiceChannel(interaction.guild, channelName);

        if (!targetChannel) {
            return interaction.reply({
                content: `Hmm... channel **${channelName}** belum ketemu di server ini, Meow~`,
                ephemeral: true
            });
        }

        try {
            await interaction.reply({
                content: "Mmm... Meow sedang pindah Voice Channel dulu ya~",
                ephemeral: true
            });
            const result = await voiceManager.setTarget(guildId, targetChannel.id);
            if (result.invalid) {
                await interaction.editReply("Aduh~ Meow tidak bisa melihat atau masuk ke channel itu. Target standby dibatalkan ya.");
            } else {
                await interaction.editReply(result.ready
                    ? `Sip~ Meow sudah pindah dan standby di **${targetChannel.name}**!`
                    : `Hmm... Meow belum berhasil masuk ke **${targetChannel.name}**. Target sudah diperbarui dan recovery akan dicoba.`);
            }
            console.log(`[TARGET] ${new Date().toISOString()} /move: ${targetChannel.name} (${guildId})`);
        } catch (error) {
            console.error(`[ERROR] ${new Date().toISOString()} /move guild ${guildId}: ${error?.message ?? String(error)}`);
            if (interaction.replied || interaction.deferred) await interaction.editReply("Aduh~ Meow gagal pindah Voice Channel. Coba `/move` lagi ya.");
            else await interaction.reply({ content: "Aduh~ Meow gagal pindah Voice Channel. Coba `/move` lagi ya.", ephemeral: true });
        }

        return;
    }

    if (interaction.commandName === "leave") {
        await voiceManager.leave(guildId);
        await interaction.reply({
            content: "Oke~ Meow sudah keluar dari Voice Channel. Kalau mau masuk lagi, panggil `/join` ya!",
            ephemeral: true
        });
        return;
    }

    if (interaction.commandName === "say") {
        const targetUser = interaction.options.getUser("user");
        const text = interaction.options.getString("text");

        if (!targetUser || !text) {
            return interaction.reply({
                content: "Mmm... formatnya `/say @user text` ya. Pilih user dan isi pesannya dulu~",
                ephemeral: true
            });
        }

        await interaction.reply({
            content: `${targetUser} ${text}`,
            ephemeral: true,
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
            return interaction.reply({ content: "Mmm... Meow belum punya target standby. Gunakan `/join` saat kamu ada di Voice Channel, atau `/move` untuk memilih channel.", ephemeral: true });
        }
        const channel = interaction.guild.channels.cache.get(status.channelId) ??
            await interaction.guild.channels.fetch(status.channelId).catch(() => null);
        const label = {
            ready: "🟢 Meow sudah terhubung dan standby",
            connecting: "🟠 Mmm... Meow sedang menyambung atau recovery",
            failed: "🔴 Meow belum tersambung. Coba `/join` lagi ya",
            disconnected: "🔴 Meow sedang tidak terhubung"
        }[status.state];
        return interaction.reply({
            content: `${label ?? "⚪ Status tidak diketahui"}\n📡 Status koneksi: **${status.connectionStatus}**\n🎙️ Target: **${channel?.name ?? status.channelId}**\n🛠️ Upaya koneksi/recovery berjalan: **${status.connecting ? "Ya" : "Tidak"}**${status.lastError ? `\n⚠️ Keterangan: ${status.lastError}` : ""}`,
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
                    content: `Mmm... kamu sudah ada di room **${currentRoom.code}**. Gunakan /game code:${currentRoom.code} untuk cek room itu ya~`,
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
                content: `Yay~ room game baru sudah dibuat!\nKode room: **${newCode}**\nPemain: 1/6\nGunakan /game code:${newCode} untuk ikut join ya~`,
                ephemeral: true,
                allowedMentions: { parse: [] }
            });
        }

        const targetRoom = getRoomByCode(lobbyCode);

        if (!targetRoom) {
            return interaction.reply({
                content: `Hmm... room **${lobbyCode}** belum ketemu. Buat room baru dengan /game ya~`,
                ephemeral: true
            });
        }

        if (targetRoom.guildId !== guildId) {
            return interaction.reply({
                content: "Aduh~ kode room ini bukan untuk server ini ya.",
                ephemeral: true
            });
        }

        if (targetRoom.players.has(userId)) {
            return interaction.reply({
                content: `Mmm... kamu sudah ada di room **${targetRoom.code}** kok~`,
                ephemeral: true
            });
        }

        if (targetRoom.players.size >= MAX_GAME_ROOM_PLAYERS) {
            return interaction.reply({
                content: `Aduh~ room **${targetRoom.code}** sudah penuh, maksimal ${MAX_GAME_ROOM_PLAYERS} pemain ya.`,
                ephemeral: true
            });
        }

        targetRoom.players.add(userId);

        return interaction.reply({
            content: `Yay~ kamu berhasil join room **${targetRoom.code}**!\nPemain sekarang: **${targetRoom.players.size}/${MAX_GAME_ROOM_PLAYERS}**`,
            ephemeral: true,
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

process.on("unhandledRejection", (reason) => {
    console.error(`[ERROR] ${new Date().toISOString()} unhandled promise rejection: ${reason?.stack ?? reason}`);
});

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
