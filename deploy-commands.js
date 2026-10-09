require("dotenv").config();

const {
    REST,
    Routes,
    ApplicationCommandOptionType
} = require("discord.js");

const commands = [
    {
        name: "join",
        description: "Masuk ke Voice Channel tempatmu saat ini"
    },
    {
        name: "help",
        description: "Lihat daftar command bot"
    },
    {
        name: "ping",
        description: "Cek respon bot"
    },
    {
        name: "move",
        description: "Pindahkan bot ke channel voice tertentu",
        options: [
            {
                name: "channel",
                description: "Nama channel voice",
                type: ApplicationCommandOptionType.String,
                required: true
            }
        ]
    },
    {
        name: "say",
        description: "Mention user dan kirim text tertentu",
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
        description: "Lihat info bot, developer, dan repo"
    },
    {
        name: "status",
        description: "Cek channel bot saat ini"
    },
    {
        name: "leave",
        description: "Keluar dari Voice Channel"
    }
];

const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

(async () => {
    try {
        if (!process.env.CLIENT_ID || !process.env.GUILD_ID || !process.env.DISCORD_TOKEN) {
            throw new Error("ENV belum lengkap. Harap isi DISCORD_TOKEN, CLIENT_ID, dan GUILD_ID di .env");
        }

        console.log("🔄 Mendaftarkan commands...");

        const deployPromise = rest.put(
            Routes.applicationGuildCommands(
                process.env.CLIENT_ID,
                process.env.GUILD_ID
            ),
            {
                body: commands
            }
        );

        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => {
                reject(new Error("Discord API timeout setelah 15 detik."));
            }, 15000);
        });

        const result = await Promise.race([deployPromise, timeoutPromise]);

        console.log("📦 Hasil deploy:", result);
        console.log("✅ Commands berhasil didaftarkan!");
    } catch (error) {
        console.error("❌ Gagal mendaftarkan commands:");
        console.error(error);
        process.exitCode = 1;
    }
})();