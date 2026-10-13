const { ApplicationCommandOptionType } = require("discord.js");

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

module.exports = { commands };
