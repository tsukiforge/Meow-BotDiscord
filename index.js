require("dotenv").config();

const {
    Client,
    GatewayIntentBits,
    Events
} = require("discord.js");

const {
    joinVoiceChannel,
    getVoiceConnection
} = require("@discordjs/voice");

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates
    ]
});

// Menyimpan Voice Channel yang sedang ditempati
const voiceRooms = new Map();

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

    // =========================
    // /join
    // =========================
    if (interaction.commandName === "join") {
        const channel = interaction.member.voice.channel;

        if (!channel) {
            return interaction.reply({
                content: "🎙️ Kamu harus masuk Voice Channel dulu~",
                ephemeral: true
            });
        }

        const existingConnection = getVoiceConnection(guildId);

        // Kalau sudah berada di channel yang sama
        if (
            existingConnection &&
            voiceRooms.get(guildId) === channel.id
        ) {
            return interaction.reply(
                `🐱 Meow~ aku sudah standby di **${channel.name}**~`
            );
        }

        try {
            // Kalau sebelumnya ada koneksi lain, hancurkan dulu
            if (existingConnection) {
                existingConnection.destroy();
            }

            joinVoiceChannel({
                channelId: channel.id,
                guildId: guildId,
                adapterCreator: channel.guild.voiceAdapterCreator,
                selfDeaf: true,
                selfMute: true
            });

            voiceRooms.set(guildId, channel.id);

            await interaction.reply(
                `🐱 Meow~ masuk ke **${channel.name}** dan akan tetap standby di sana~`
            );

            console.log(
                `🎙️ Join: ${channel.name} (${guildId})`
            );

        } catch (error) {
            console.error("❌ Voice join error:", error);

            await interaction.reply({
                content: "❌ Meow~ gagal masuk ke Voice Channel.",
                ephemeral: true
            });
        }

        return;
    }

    // =========================
    // /leave
    // =========================
    if (interaction.commandName === "leave") {
        const connection = getVoiceConnection(guildId);

        if (!connection) {
            return interaction.reply({
                content: "🐱 Meow~ sedang tidak berada di Voice Channel.",
                ephemeral: true
            });
        }

        connection.destroy();
        voiceRooms.delete(guildId);

        console.log(`👋 Leave: ${guildId}`);

        await interaction.reply(
            "👋 Meow~ sudah keluar dari Voice Channel."
        );

        return;
    }

    // =========================
    // /status
    // =========================
    if (interaction.commandName === "status") {
        const connection = getVoiceConnection(guildId);
        const channelId = voiceRooms.get(guildId);

        if (!connection || !channelId) {
            return interaction.reply(
                "🔴 **Meow~ tidak berada di Voice Channel.**"
            );
        }

        const channel =
            interaction.guild.channels.cache.get(channelId);

        await interaction.reply(
            `🟢 **Meow~ sedang standby**\n` +
            `🎙️ Channel: **${channel?.name ?? "Unknown"}**`
        );

        return;
    }
});

// =========================
// DIAM-DIAM RECONNECT
// =========================

client.on(Events.VoiceStateUpdate, (oldState, newState) => {
    if (!client.user) return;

    // Hanya memproses perubahan voice milik bot
    if (oldState.member?.id !== client.user.id) return;

    const guildId = oldState.guild.id;
    const channelId = voiceRooms.get(guildId);

    // Bot memang tidak sedang ditugaskan standby
    if (!channelId) return;

    // Bot masih berada di VC
    if (newState.channelId) return;

    const guild = oldState.guild;
    const channel = guild.channels.cache.get(channelId);

    if (!channel) {
        voiceRooms.delete(guildId);
        return;
    }

    console.log(
        `⚠️ Meow~ terputus dari ${channel.name}. Mencoba reconnect...`
    );

    setTimeout(() => {
        // User mungkin sudah menggunakan /leave
        if (!voiceRooms.has(guildId)) return;

        try {
            joinVoiceChannel({
                channelId: channel.id,
                guildId: guild.id,
                adapterCreator: guild.voiceAdapterCreator,
                selfDeaf: true,
                selfMute: true
            });

            console.log(
                `🔄 Meow~ mencoba kembali ke ${channel.name}`
            );

        } catch (error) {
            console.error(
                "❌ Voice reconnect error:",
                error
            );
        }
    }, 5000);
});

// =========================
// LOGIN
// =========================

client.login(process.env.DISCORD_TOKEN);