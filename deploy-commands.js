require("dotenv").config();

const {
    Client,
    GatewayIntentBits,
    Events,
    REST,
    Routes,
    ApplicationCommandOptionType
} = require("discord.js");

const commands = [
    {
        name: "join",
        description: "Meow masuk ke voice channel kamu"
    },
    {
        name: "help",
        description: "Lihat semua command Meow"
    },
    {
        name: "ping",
        description: "Cek apakah Meow masih menyala"
    },
    {
        name: "move",
        description: "Pindahkan Meow ke voice channel lain",
        options: [
            {
                name: "channel",
                description: "Nama voice channel tujuan",
                type: ApplicationCommandOptionType.String,
                required: true
            }
        ]
    },
    {
        name: "say",
        description: "Kirim pesan untuk user tertentu",
        options: [
            {
                name: "user",
                description: "User yang ingin disebut",
                type: ApplicationCommandOptionType.User,
                required: true
            },
            {
                name: "text",
                description: "Isi pesan yang ingin dikirim",
                type: ApplicationCommandOptionType.String,
                required: true
            }
        ]
    },
    {
        name: "about",
        description: "Lihat info tentang MeowBot"
    },
    {
        name: "status",
        description: "Cek status koneksi Meow"
    },
    {
        name: "leave",
        description: "Minta Meow keluar dari voice channel"
    },
    {
        name: "game",
        description: "Buat atau join room game",
        options: [
            {
                name: "code",
                description: "Kode room yang ingin di-join",
                type: ApplicationCommandOptionType.String,
                required: false
            }
        ]
    }
];

const client = new Client({
    intents: [GatewayIntentBits.Guilds]
});
const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);
const DEPLOY_TIMEOUT_MS = 30000;

async function deployCommands() {
    if (!process.env.CLIENT_ID || !process.env.DISCORD_TOKEN) {
        throw new Error("ENV belum lengkap. Isi DISCORD_TOKEN dan CLIENT_ID di .env");
    }

    await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Login Discord timeout setelah 30 detik.")), DEPLOY_TIMEOUT_MS);
        client.once(Events.ClientReady, () => {
            clearTimeout(timeout);
            resolve();
        });
        client.login(process.env.DISCORD_TOKEN).catch((error) => {
            clearTimeout(timeout);
            reject(error);
        });
    });

    const guilds = [...client.guilds.cache.values()];
    if (guilds.length === 0) {
        throw new Error("Bot belum terdaftar di guild mana pun atau tidak memiliki akses Guilds.");
    }

    console.log(`[DEPLOY] ${new Date().toISOString()} menemukan ${guilds.length} guild; mendaftarkan command...`);
    for (const guild of guilds) {
        const result = await rest.put(
            Routes.applicationGuildCommands(process.env.CLIENT_ID, guild.id),
            { body: commands }
        );
        console.log(`[DEPLOY] ${new Date().toISOString()} ${guild.name} (${guild.id}): ${result.length} command aktif`);
    }
}

deployCommands()
    .then(() => {
        console.log(`[DEPLOY] ${new Date().toISOString()} semua command selesai didaftarkan`);
        client.destroy();
    })
    .catch((error) => {
        console.error(`[ERROR] ${new Date().toISOString()} pendaftaran command gagal: ${error?.message ?? String(error)}`);
        client.destroy();
        process.exitCode = 1;
    });
