const { Client, GatewayIntentBits, Events } = require("discord.js");

const BOT_NAME = "MeowBot";
const DEVELOPER_NAME = "tsukiforge";
const REPO_URL = "https://github.com/tsukiforge/Meow-BotDiscord";
const ABOUT_TEXT = "MeowBot adalah bot Discord ringan yang dibuat untuk membantu server dengan fitur sederhana, friendly, dan mudah digunakan.";

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

client.once(Events.ClientReady, () => {
  console.log(`Bot ready: ${client.user.tag}`);
});

client.on(Events.GuildCreate, async (guild) => {
  try {
    const owner = await guild.fetchOwner().catch(() => null);
    const adminUser = owner?.user ?? (await client.users.fetch(guild.ownerId).catch(() => null));

    if (!adminUser) {
      console.log(`Tidak bisa kirim DM, owner server tidak ditemukan: ${guild.name}`);
      return;
    }

    const message = [
      `Halo! Meow~ 🐾`,
      ``,
      `Terima kasih sudah install **${BOT_NAME}** di server **${guild.name}**.`,
      ``,
      `Saya, **${DEVELOPER_NAME}**, developer dari bot ini, ingin mengucapkan terima kasih atas kepercayaannya.`,
      ``,
      `**${BOT_NAME}** dibuat untuk membantu server kamu tetap hidup, rapi, dan nyaman dengan fitur yang sederhana tapi berguna.`,
      ``,
      `Untuk mulai menggunakan bot, kamu bisa coba command berikut:`,
      `- /help`,
      `- /ping`,
      `- /move <nama channel>`,
      `- /status`,
      `- /about`,
      ``,
      `**Tentang bot:**`,
      `${ABOUT_TEXT}`,
      ``,
      `**Repository / source code:**`,
      `${REPO_URL}`,
      ``,
      `Kalau kamu butuh bantuan, mau request fitur, atau mau lihat update terbaru, silakan hubungi saya melalui Discord developer ini.`,
      ``,
      `Semoga **${BOT_NAME}** bermanfaat untuk server kamu. Meow~`,
      ``,
      `Salam hangat,`,
      `**${DEVELOPER_NAME}**`,
      `Developer ${BOT_NAME}`
    ].join("\n");

    await adminUser.send({ content: message });
    console.log(`DM install berhasil dikirim ke owner server: ${guild.name}`);

  } catch (error) {
    console.error(`Gagal kirim DM install untuk server ${guild.name}:`, error);
  }
});

client.login(process.env.DISCORD_TOKEN);
