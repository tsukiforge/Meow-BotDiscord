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

        await rest.put(
            Routes.applicationGuildCommands(
                process.env.CLIENT_ID,
                process.env.GUILD_ID
            ),
            {
                body: commands
            }
        );

        console.log("✅ Commands berhasil didaftarkan!");
    } catch (error) {
        console.error(error);
    }
})();