require("dotenv").config();

const {
    REST,
    Routes
} = require("discord.js");

const commands = [
    {
        name: "join",
        description: "Meow~ masuk ke Voice Channel kamu"
    },
    {
        name: "leave",
        description: "Meow~ keluar dari Voice Channel"
    },
    {
        name: "status",
        description: "Melihat status Meow~"
    }
];

const rest = new REST({ version: "10" })
    .setToken(process.env.DISCORD_TOKEN);

(async () => {
    try {
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
                reject(
                    new Error(
                        "Discord API timeout setelah 15 detik."
                    )
                );
            }, 15000);
        });

        const result = await Promise.race([
            deployPromise,
            timeoutPromise
        ]);

        console.log("📦 Hasil deploy:", result);
        console.log("✅ Commands berhasil didaftarkan!");

    } catch (error) {
        console.error("❌ Gagal mendaftarkan commands:");
        console.error(error);

        process.exitCode = 1;
    }
})();