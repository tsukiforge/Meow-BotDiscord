# MeowBot

Bot Discord sederhana yang ringan untuk clone dan dipakai di server kecil.

## Tentang bot
MeowBot adalah bot Discord yang fokus pada fitur ringan, sederhana, dan cocok untuk hosting gratis. Bot ini dibuat untuk membantu server kecil dengan command dasar seperti info, status voice, move channel, dan mention singkat.

## Fitur utama
- `/help` — menampilkan daftar command yang tersedia
- `/about` — menampilkan profil bot, developer, dan repo
- `/ping` — mengecek apakah bot masih hidup
- `/move <nama channel>` — memindahkan bot ke channel voice tertentu
- `/say @user text` — mention user lalu kirim teks yang dimasukkan
- `/status` — mengecek channel voice bot sedang aktif di mana
- `/leave` — mengeluarkan bot dari voice channel

## Perbedaan command

### `/help`
Digunakan untuk melihat daftar command yang bisa dipakai bot. Ini seperti menu bantuan.

### `/about`
Digunakan untuk melihat informasi bot, seperti:
- nama bot
- developer
- repository
- deskripsi singkat

### `/status`
Digunakan untuk mengecek status bot saat ini, terutama apakah bot sedang berada di voice channel dan channel mana yang aktif.

### `/ping`
Digunakan untuk mengecek respon bot. Kalau bot hidup, biasanya akan membalas dengan `Pong!`.

## Langkah install

1. Clone repo
   ```bash
   git clone https://github.com/tsukiforge/Meow-BotDiscord
   cd MeowBot
   ```

2. Install dependency
   ```bash
   npm install
   ```

3. Buat file .env dari .env.example
   ```bash
   copy .env.example .env
   ```

4. Isi token dan ID server
   ```env
   DISCORD_TOKEN=...
   CLIENT_ID=...
   GUILD_ID=...
   ```

5. Deploy command Discord
   ```bash
   node deploy-commands.js
   ```

6. Jalankan bot
   ```bash
   npm start
   ```

## Command yang tersedia
- `/help`
- `/about`
- `/ping`
- `/move general`
- `/say @user Halo`
- `/status`
- `/leave`

## Catatan
Bot ini dibuat tetap ringan, tanpa fitur musik streaming berat, sehingga cocok untuk hosting gratis atau server kecil.

## Tips penggunaan
- Gunakan `/help` kerap kali saat pertama kali memakai bot.
- Gunakan `/about` untuk melihat info bot dan repo developer.
- Gunakan `/status` untuk mengecek apakah bot sudah ada di voice channel.
- Jangan pakai fitur musik berat jika target server memakai hosting gratis, karena cukup boros sumber daya.
