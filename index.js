require("dotenv").config();

const {
    Client,
    GatewayIntentBits,
    Events,
    ChannelType
} = require("discord.js");

const {
    joinVoiceChannel,
    getVoiceConnection,
    VoiceConnectionStatus
} = require("@discordjs/voice");

const BOT_NAME = "MeowBot";
const DEVELOPER_NAME = "tsukiforge";
const REPO_URL = "https://github.com/tsukiforge/Meow-BotDiscord";
const ABOUT_TEXT = "MeowBot adalah bot Discord ringan yang dibuat untuk membantu server dengan fitur sederhana, friendly, dan mudah digunakan.";
const MAX_GAME_ROOM_PLAYERS = 6;
const gameRooms = new Map();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates
    ]
});

const activeVoiceChannels = new Map();

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

function isConnectionHealthy(connection) {
    if (!connection) return false;

    return connection.state.status === VoiceConnectionStatus.Ready;
}

function getCurrentVoiceChannel(guildId) {
    const connection = getVoiceConnection(guildId);

    if (!connection || connection.state.status === VoiceConnectionStatus.Destroyed) {
        return null;
    }

    return connection.joinConfig?.channelId ?? null;
}

function getVoiceStatusLabel(connection) {
    if (!connection) return "NotConnected";

    return connection.state.status;
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

client.once(Events.ClientReady, (bot) => {
    console.log(`🐱 Meow~ online sebagai ${bot.user.tag}`);
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
            const existingConnection = getVoiceConnection(guildId);
            if (existingConnection && isConnectionHealthy(existingConnection) && existingConnection.joinConfig.channelId === currentChannel.id) {
                return interaction.reply(`🐱 Meow~ aku sudah berada di **${currentChannel.name}**.`);
            }

            if (existingConnection && existingConnection.state.status !== VoiceConnectionStatus.Destroyed) {
                existingConnection.destroy();
            }

            const connection = joinVoiceChannel({
                channelId: currentChannel.id,
                guildId,
                adapterCreator: interaction.guild.voiceAdapterCreator,
                selfDeaf: true,
                selfMute: true
            });

            activeVoiceChannels.set(guildId, {
                channelId: currentChannel.id
            });

            if (!isConnectionHealthy(connection)) {
                await interaction.reply({
                    content: "⚠️ Meow~ sedang mencoba menyambungkan ke voice channel. Coba lagi sebentar.",
                    ephemeral: true
                });
                return;
            }

            await interaction.reply(`🐱 Meow~ masuk ke **${currentChannel.name}**.`);
        } catch (error) {
            console.error("❌ Join voice error:", error);
            await interaction.reply({
                content: "❌ Meow~ gagal masuk ke Voice Channel.",
                ephemeral: true
            });
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
            const existingConnection = getVoiceConnection(guildId);

            if (existingConnection && isConnectionHealthy(existingConnection) && existingConnection.joinConfig.channelId === targetChannel.id) {
                return interaction.reply(`🐱 Meow~ aku sudah ada di **${targetChannel.name}**.`);
            }

            if (existingConnection && existingConnection.state.status !== VoiceConnectionStatus.Destroyed) {
                existingConnection.destroy();
            }

            const connection = joinVoiceChannel({
                channelId: targetChannel.id,
                guildId,
                adapterCreator: targetChannel.guild.voiceAdapterCreator,
                selfDeaf: true,
                selfMute: true
            });

            activeVoiceChannels.set(guildId, {
                channelId: targetChannel.id
            });

            if (!isConnectionHealthy(connection)) {
                await interaction.reply({
                    content: "⚠️ Meow~ sedang mencoba pindah ke voice channel. Coba lagi sebentar.",
                    ephemeral: true
                });
                return;
            }

            await interaction.reply(`🐱 Meow~ pindah ke **${targetChannel.name}**.`);
            console.log(`🔁 Move: ${targetChannel.name} (${guildId})`);
        } catch (error) {
            console.error("❌ Move voice error:", error);
            await interaction.reply({
                content: "❌ Meow~ gagal pindah ke channel voice.",
                ephemeral: true
            });
        }

        return;
    }

    if (interaction.commandName === "leave") {
        const connection = getVoiceConnection(guildId);
        if (!connection) {
            return interaction.reply({
                content: "🐱 Meow~ sedang tidak berada di Voice Channel.",
                ephemeral: true
            });
        }

        connection.destroy();
        activeVoiceChannels.delete(guildId);

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
                parse: ["users"]
            }
        });

        return;
    }

    if (interaction.commandName === "status") {
        const connection = getVoiceConnection(guildId);

        if (!connection || !isConnectionHealthy(connection)) {
            return interaction.reply("🔴 **Meow~ tidak berada di Voice Channel.**");
        }

        const channel = interaction.guild.channels.cache.get(connection.joinConfig?.channelId);

        return interaction.reply(
            `🟢 **Meow~ sedang tersambung**\n📡 Status: **${getVoiceStatusLabel(connection)}**\n🎙️ Channel: **${channel?.name ?? "Unknown"}**`
        );
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

client.login(process.env.DISCORD_TOKEN);