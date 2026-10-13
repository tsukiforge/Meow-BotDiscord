# MeowBot

Bot Discord ringan dan sederhana untuk server kecil. Fokus utama bot ini adalah voice channel dasar, status, dan command keluarga kecil tanpa dependency yang berat.

## Fitur utama
- `/join` — masuk ke Voice Channel tempat pengguna saat ini berada
- `/help` — menampilkan daftar command yang tersedia
- `/about` — menampilkan profil bot, developer, dan repo
- `/ping` — mengecek apakah bot masih hidup
- `/move <nama channel>` — memindahkan bot ke channel voice tertentu
- `/say @user text` — mention user lalu kirim teks yang dimasukkan
- `/status` — mengecek kondisi koneksi dan channel voice bot saat ini
- `/leave` — menghentikan koneksi dan keluar dari voice channel

## Persyaratan
- Node.js 18.17.0 atau lebih baru (Node.js 20/22 LTS disarankan untuk hosting)
- Discord.js v14
- @discordjs/voice versi yang kompatibel dengan Discord.js v14
- Akses bot ke server dengan permission untuk join/move voice channel dan lihat guild

## Langkah install

1. Clone repo
   ```bash
   git clone https://github.com/tsukiforge/Meow-BotDiscord.git
   cd Meow-BotDiscord
   ```

2. Install dependency
   ```bash
   npm install
   ```

3. Salin file contoh environment
   ```bash
   copy .env.example .env
   ```
   atau pada Linux/macOS:
   ```bash
   cp .env.example .env
   ```

4. Isi env yang dibutuhkan di `.env`
   ```env
   DISCORD_TOKEN=your_discord_bot_token
   CLIENT_ID=your_application_id
   ```

5. Daftarkan slash command otomatis ke semua guild yang bisa diakses bot
   ```bash
   node deploy-commands.js  # otomatis ke semua guild yang ditemukan bot
   ```

6. Jalankan bot secara permanen
   ```bash
   npm start
   ```

> `deploy-commands.js` hanya untuk pendaftaran command; jangan dijalankan sebagai proses utama bot 24/7.

## Command yang tersedia
- `/join`
- `/help`
- `/about`
- `/ping`
- `/move general`
- `/say @user Halo`
- `/status`
- `/leave`

## Penjelasan command

### `/join`
Masuk ke voice channel pengguna yang menjalankan command. Jika pengguna tidak berada di voice channel, bot akan menolak dengan pesan yang ramah.

### `/leave`
Menghentikan koneksi voice dan mengeluarkan bot dari channel. Bot tidak akan otomatis reconnect setelah keluar manual.

### `/status`
Menampilkan status koneksi voice dan channel yang sedang digunakan bot.

### `/move`
Memindahkan bot ke channel voice yang sesuai berdasarkan nama channel.

### `/say`
Mengirim pesan dengan mention user tertentu tanpa memicu mention massal. Format dasar:
```bash
/say @user Halo semuanya
```

## Hosting di Wispbyte
1. Upload project hasil clone ke environment Wispbyte.
2. Pilih runtime Node.js 18.17.0 atau lebih baru; Node.js 20/22 LTS disarankan.
3. Set variabel environment di Wispbyte:
   - `DISCORD_TOKEN`
   - `CLIENT_ID`
4. Jalankan perintah install secara manual jika diperlukan:
   ```bash
   npm install
   ```
5. Jalankan pendaftaran command satu kali:
   ```bash
   node deploy-commands.js  # otomatis ke semua guild yang ditemukan bot
   ```
6. Gunakan `npm start` sebagai command boot utama bot (`node index.js`). Jangan gunakan `node deploy-commands.js` sebagai proses utama.
7. Aktifkan opsi auto-restart/restart-on-crash di panel Wispbyte jika tersedia untuk paket/server Anda. Pastikan startup command tetap `npm start`, dan periksa console/log panel setelah crash. Ketersediaan serta nama opsi restart berbeda menurut paket dan panel Wispbyte; repository ini tidak dapat memastikan fitur itu aktif di akun Anda.
8. Pastikan filesystem tempat bot berjalan tetap ada di antara restart dan gunakan direktori kerja project yang sama. Target disimpan di `voice-targets.json` (hanya ID guild/channel, tanpa token). Setelah server/proses menyala kembali, bot akan mencoba auto-rejoin jika `AUTO_REJOIN_ON_START=true`; jika tidak, jalankan `/join` atau `/move` secara manual. Jika filesystem/container bersifat ephemeral atau file dihapus saat redeploy, target tersimpan tidak tersedia.

`deploy-commands.js` dijalankan satu kali secara terpisah setelah perubahan command. Proses utamanya hanya `index.js`; bot tidak membuat proses tambahan untuk menghindari batas hosting.

## Voice standby dan pemulihan
- `/join` menyimpan target channel dan menyambungkan bot atas permintaan manual. Setelah proses restart, bot otomatis mencoba masuk kembali ke target tersimpan jika `AUTO_REJOIN_ON_START=true`.
- `/move` mengganti target dan mencoba koneksi atas permintaan manual; `/leave` memutus koneksi serta menghapus target tersimpan.
- Jika koneksi voice terputus tanpa disengaja, bot menjalankan Fast Recovery dengan retry terbatas dan backoff pendek. Recovery tidak membuat koneksi ganda, memvalidasi ulang guild/channel/izin, dan berhenti setelah seluruh percobaan gagal. Jalankan `/join` atau `/move` untuk memulai sesi manual baru setelah itu. Channel yang tidak tersedia atau tidak memiliki izin tidak digunakan.
- `/status` menampilkan keadaan koneksi aktual, target, dan apakah upaya koneksi atau recovery sedang berjalan. Status proses yang benar-benar mati hanya bisa dipastikan dari panel/log hosting, bukan melalui slash command.
- `/leave` membatalkan timer serta seluruh upaya recovery yang tertunda. Bot tidak akan masuk kembali ke voice channel sampai `/join` atau `/move` dijalankan lagi.
- Set `AUTO_REJOIN_ON_START=false` jika sesi voice harus menunggu `/join` atau `/move` manual setelah restart. Target tetap divalidasi sebelum auto-rejoin dan target yang sudah tidak valid akan dihapus.
- Bot tidak menjamin uptime 100%. Pemulihan bergantung pada Discord, izin bot, ketersediaan filesystem target, dan konfigurasi restart Wispbyte.

Jalankan tes logika koneksi dengan `npm test`.

## Catatan
- Bot dibuat ringan dan cocok untuk hosting gratis atau server kecil.
- Fitur musik, streaming audio, dan dependency berat tidak termasuk dalam project ini.
- Command didaftarkan otomatis ke semua guild yang sedang bisa diakses bot.
