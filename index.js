require("dotenv").config();

const {
    Client,
    GatewayIntentBits,
    Events,
    ChannelType
} = require("discord.js");

const {
    joinVoiceChannel,
    getVoiceConnection
} = require("@discordjs/voice");

const BOT_NAME = "MeowBot";
const DEVELOPER_NAME = "tsukiforge";
const REPO_URL = "https://github.com/tsukiforge/Meow-BotDiscord";
const ABOUT_TEXT = "MeowBot adalah bot Discord ringan yang dibuat untuk membantu server dengan fitur sederhana, friendly, dan mudah digunakan.";

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

function getCurrentVoiceChannel(guildId) {
    const connection = getVoiceConnection(guildId);
    return connection?.joinConfig?.channelId ?? null;
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
                ``,
                `**Developer:** ${DEVELOPER_NAME}`,
                `**Repo:** ${REPO_URL}`,
                ``,
                `${ABOUT_TEXT}`,
                ``,
                "**Command utama:** `/help`, `/ping`, `/move`, `/status`, `/say`, `/about`, `/leave`"
            ].join("\n"),
            ephemeral: true
        });
    }

    if (interaction.commandName === "move") {
        const channelName = interaction.options.getString("channel");
        const targetChannel = findVoiceChannel(
            interaction.guild,
            channelName
        );

        if (!targetChannel) {
            return interaction.reply({
                content: `❌ Channel **${channelName}** tidak ditemukan di server ini.`,
                ephemeral: true
            });
        }

        try {
            const existingConnection = getVoiceConnection(guildId);

            if (existingConnection) {
                if (existingConnection.joinConfig.channelId === targetChannel.id) {
                    return interaction.reply(
                        `🐱 Meow~ aku sudah ada di **${targetChannel.name}**.`
                    );
                }

                existingConnection.destroy();
            }

            joinVoiceChannel({
                channelId: targetChannel.id,
                guildId: guildId,
                adapterCreator: targetChannel.guild.voiceAdapterCreator,
                selfDeaf: true,
                selfMute: true
            });

            activeVoiceChannels.set(guildId, targetChannel.id);

            await interaction.reply(
                `🐱 Meow~ pindah ke **${targetChannel.name}**.`
            );

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
        const currentChannelId = getCurrentVoiceChannel(guildId);

        if (!currentChannelId) {
            return interaction.reply(
                "🔴 **Meow~ tidak berada di Voice Channel.**"
            );
        }

        const channel = interaction.guild.channels.cache.get(currentChannelId);

        return interaction.reply(
            `🟢 **Meow~ sedang standby**\n🎙️ Channel: **${channel?.name ?? "Unknown"}**`
        );
    }
});

client.on(Events.VoiceStateUpdate, (oldState, newState) => {
    if (!client.user) return;
    if (oldState.member?.id !== client.user.id) return;

    const guildId = oldState.guild.id;
    const expectedChannelId = activeVoiceChannels.get(guildId);

    if (!expectedChannelId) return;

    const currentChannelId = getCurrentVoiceChannel(guildId);

    if (!currentChannelId && newState.channelId === null) {
        const guild = oldState.guild;
        const channel = guild.channels.cache.get(expectedChannelId);

        if (!channel) {
            activeVoiceChannels.delete(guildId);
            return;
        }

        console.log(`⚠️ Meow~ terputus dari ${channel.name}, reconnect...`);

        setTimeout(() => {
            if (activeVoiceChannels.get(guildId) !== expectedChannelId) return;

            try {
                joinVoiceChannel({
                    channelId: channel.id,
                    guildId: guild.id,
                    adapterCreator: guild.voiceAdapterCreator,
                    selfDeaf: true,
                    selfMute: true
                });
            } catch (error) {
                console.error("❌ Reconnect error:", error);
            }
        }, 3000);
    }
});

client.login(process.env.DISCORD_TOKEN);