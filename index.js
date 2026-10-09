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
    VoiceConnectionStatus,
    entersState
} = require("@discordjs/voice");

const BOT_NAME = "MeowBot";
const DEVELOPER_NAME = "tsukiforge";
const REPO_URL = "https://github.com/tsukiforge/Meow-BotDiscord";
const ABOUT_TEXT = "MeowBot adalah bot Discord ringan yang dibuat untuk membantu server dengan fitur sederhana, friendly, dan mudah digunakan.";
const MAX_RECONNECT_ATTEMPTS = 3;
const RECONNECT_DELAY_MS = 2000;

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates
    ]
});

const activeVoiceChannels = new Map();
const reconnectTimers = new Map();
const manualDisconnects = new Set();

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

function clearReconnect(guildId) {
    const timer = reconnectTimers.get(guildId);
    if (timer) {
        clearTimeout(timer);
        reconnectTimers.delete(guildId);
    }
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

async function reconnectToChannel(guild, channelId) {
    if (!guild || !channelId) return;
    if (manualDisconnects.has(guild.id)) return;

    const expected = activeVoiceChannels.get(guild.id);
    if (!expected || expected.channelId !== channelId) return;

    if (reconnectTimers.has(guild.id)) return;

    const attempt = expected.reconnectAttempts || 0;
    if (attempt >= MAX_RECONNECT_ATTEMPTS) {
        activeVoiceChannels.delete(guild.id);
        return;
    }

    const delayMs = Math.min(RECONNECT_DELAY_MS * (attempt + 1), 8000);

    const timer = setTimeout(async () => {
        reconnectTimers.delete(guild.id);

        if (manualDisconnects.has(guild.id)) return;

        const currentConnection = getVoiceConnection(guild.id);
        if (isConnectionHealthy(currentConnection) && currentConnection.joinConfig.channelId === channelId) {
            activeVoiceChannels.set(guild.id, { channelId, reconnectAttempts: 0 });
            return;
        }

        const targetChannel = guild.channels.cache.get(channelId);
        if (!targetChannel || targetChannel.type !== ChannelType.GuildVoice) {
            activeVoiceChannels.delete(guild.id);
            return;
        }

        try {
            const connection = joinVoiceChannel({
                channelId: targetChannel.id,
                guildId: guild.id,
                adapterCreator: guild.voiceAdapterCreator,
                selfDeaf: true,
                selfMute: true
            });

            activeVoiceChannels.set(guild.id, {
                channelId,
                reconnectAttempts: attempt + 1
            });

            await entersState(connection, VoiceConnectionStatus.Ready, 15000)
                .catch(() => {
                    console.warn(`⚠️ Timed out reconnecting to ${targetChannel.name}.`);
                });
        } catch (error) {
            console.error("❌ Reconnect error:", error);
            reconnectToChannel(guild, channelId);
        }
    }, delayMs);

    reconnectTimers.set(guild.id, timer);
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
                "- `/leave` — keluar dari voice channel"
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

            clearReconnect(guildId);
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
                channelId: currentChannel.id,
                reconnectAttempts: 0
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

            clearReconnect(guildId);
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
                channelId: targetChannel.id,
                reconnectAttempts: 0
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
        clearReconnect(guildId);
        manualDisconnects.add(guildId);

        const connection = getVoiceConnection(guildId);
        if (!connection) {
            manualDisconnects.delete(guildId);
            return interaction.reply({
                content: "🐱 Meow~ sedang tidak berada di Voice Channel.",
                ephemeral: true
            });
        }

        connection.destroy();
        activeVoiceChannels.delete(guildId);

        setTimeout(() => {
            manualDisconnects.delete(guildId);
        }, 1000);

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
});

client.on(Events.VoiceStateUpdate, (oldState, newState) => {
    if (!client.user || oldState.member?.id !== client.user.id) return;

    const guildId = oldState.guild.id;
    const expected = activeVoiceChannels.get(guildId);

    if (!expected || manualDisconnects.has(guildId)) return;

    const currentConnection = getVoiceConnection(guildId);
    if (isConnectionHealthy(currentConnection) && currentConnection.joinConfig.channelId === expected.channelId) {
        return;
    }

    const guild = oldState.guild;
    const channel = guild.channels.cache.get(expected.channelId);
    if (!channel) {
        activeVoiceChannels.delete(guildId);
        return;
    }

    if (newState.channelId === null || !currentConnection || currentConnection.state.status === VoiceConnectionStatus.Disconnected || currentConnection.state.status === VoiceConnectionStatus.Destroyed) {
        console.log(`⚠️ Meow~ terputus dari ${channel.name}, mencoba reconnect...`);
        reconnectToChannel(guild, expected.channelId);
    }
});

client.login(process.env.DISCORD_TOKEN);