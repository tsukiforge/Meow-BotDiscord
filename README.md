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
- `/game [kode]` — membuat atau join room game sederhana (room kosong/kadaluarsa > 6 jam dibersihkan otomatis)

## Persyaratan
- Node.js 22.12.0 atau lebih baru (dibutuhkan oleh versi terbaru `@discordjs/voice`)
- Discord.js v14
- `@discordjs/voice` dan `discord.js` versi terbaru yang tercantum di `package.json`
- `@snazzah/davey` untuk dukungan protokol DAVE dan `libsodium-wrappers` untuk enkripsi pure-JavaScript
- Akses bot ke server dengan permission untuk join/move voice channel dan lihat guild

## Izin dan hosting
- Role bot sebaiknya memiliki izin **View Audit Log** agar DM sambutan dapat dikirim ke admin yang menambahkan bot. Tanpa izin ini, penerima DM akan fallback ke owner server, lalu ke system channel jika DM tertutup.
- Link undangan bot sebaiknya menyertakan izin **View Channels**, **Connect**, **Send Messages**, dan **View Audit Log**, serta scope `bot` dan `applications.commands`.
- Hosting wajib memakai **Node.js >=22.12.0** dan sebaiknya menyediakan auto-restart saat proses crash. Secara default `EXIT_ON_UNCAUGHT=true`, sehingga `uncaughtException` membuat proses keluar agar hosting dapat memulihkannya. Set `EXIT_ON_UNCAUGHT=false` hanya jika hosting tidak memiliki auto-restart dan Anda memahami risikonya.
- Jika log `[NET]` macet pada tahap **UDP handshake**, UDP kemungkinan diblokir oleh hosting. Hal tersebut tidak dapat diperbaiki dari kode dan perlu ditanyakan kepada penyedia hosting.

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
   PERSIST_TARGETS=true
   EXIT_ON_UNCAUGHT=true
   ```
   `PERSIST_TARGETS=false` menonaktifkan penulisan `voice-targets.json` (lihat bagian "Penyimpanan target").

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
- `/game`

## Penjelasan command

### `/join`
Masuk ke voice channel pengguna yang menjalankan command. Jika pengguna tidak berada di voice channel, bot akan menolak dengan pesan yang ramah.

### `/leave`
Menghentikan koneksi voice dan mengeluarkan bot dari channel. Bot tidak akan otomatis reconnect setelah keluar manual.

### `/status`
Menampilkan status koneksi voice dan channel yang sedang digunakan bot.

### `/move`
Memindahkan bot ke channel voice yang sesuai berdasarkan nama channel. Kecocokan persis (case-insensitive) diutamakan; jika ada beberapa kecocokan parsial, bot meminta nama yang lebih spesifik.

### `/say`
Mengirim pesan publik di channel dengan mention user tertentu (hanya user yang disebut yang mendapat notifikasi, tanpa memicu mention massal). Format dasar:
```bash
/say @user Halo semuanya
```

## Hosting di Wispbyte
1. Upload project hasil clone ke environment Wispbyte.
2. Pilih runtime Node.js 22.12.0 atau lebih baru. `@discordjs/voice` versi terbaru tidak mendukung Node.js 20.
3. Set variabel environment di Wispbyte:
   - `DISCORD_TOKEN`
   - `CLIENT_ID`
   - `PERSIST_TARGETS` (opsional, default `true`)
   - `EXIT_ON_UNCAUGHT` (opsional, default `true`)
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
8. Pastikan filesystem tempat bot berjalan tetap ada di antara restart dan gunakan direktori kerja project yang sama. Target disimpan di `voice-targets.json` (hanya ID guild/channel, tanpa token). Setelah server/proses menyala kembali, bot akan mencoba auto-rejoin jika `AUTO_REJOIN_ON_START=true`; jika disetel `false`, watchdog masih dapat memulihkan target dalam waktu paling lama sekitar 60 detik. Jika filesystem/container bersifat ephemeral atau file dihapus saat redeploy, target tersimpan tidak tersedia.

`deploy-commands.js` dijalankan satu kali secara terpisah setelah perubahan command. Proses utamanya hanya `index.js`; bot tidak membuat proses tambahan untuk menghindari batas hosting.

## Voice standby dan pemulihan
- `/join` menyimpan target channel dan menyambungkan bot atas permintaan manual. Setelah proses restart, bot otomatis mencoba masuk kembali ke target tersimpan jika `AUTO_REJOIN_ON_START=true`.
- `/move` mengganti target dan mencoba koneksi atas permintaan manual; `/leave` memutus koneksi serta menghapus target tersimpan.
- Jika koneksi voice terputus tanpa disengaja (termasuk bot di-disconnect manual lewat Discord), bot menunggu 5 detik apakah koneksi pulih sendiri; jika tidak, bot membuat koneksi baru dan mencoba recovery tanpa batas dengan backoff 2, 5, 10, dan 30 detik, lalu setiap 60 detik. Hanya satu recovery aktif per guild. Target hanya dihapus saat: channel benar-benar dihapus, guild mengeluarkan bot, atau user menjalankan `/leave`. Kehilangan izin View Channel/Connect sementara, error API, atau gangguan jaringan TIDAK menghapus target — bot tetap mencoba kembali sampai berhasil.
- Watchdog setiap 60 detik memeriksa semua target tersimpan dan memulai recovery jika koneksi tidak ada atau belum `Ready`. Setelah gateway shard siap (`ShardReady`) atau resume (`ShardResume`), bot juga langsung memeriksa serta mencoba menyambungkan kembali target yang belum `Ready`.
- `/join` saat bot sudah berada di channel yang sama (bahkan sebelum status `Ready`) akan menjawab "sudah di sini" dan tidak membongkar koneksi. Spam `/join` tidak membuat bot keluar-masuk sendiri.
- `uncaughtException` menyebabkan proses keluar secara default agar host merestart bot dan target di-restore dari `voice-targets.json`. Set `EXIT_ON_UNCAUGHT=false` hanya jika hosting tidak punya auto-restart.
- Set `AUTO_REJOIN_ON_START=false` untuk menunda percobaan koneksi awal setelah proses dimulai; watchdog tetap akan memeriksa target tersimpan dan dapat memulai koneksi dalam waktu paling lama sekitar 60 detik.
- Log `[NET]` menampilkan tahap jaringan voice serta error/close code websocket. Jika log terus macet pada tahap UDP handshake, kemungkinan besar trafik UDP diblokir oleh hosting; hal ini tidak dapat diperbaiki dari kode dan perlu ditanyakan ke penyedia hosting.

## Penyimpanan target dan `PERSIST_TARGETS`
- Default (`PERSIST_TARGETS=true` atau tidak diatur): target standby disimpan di `voice-targets.json` berisi hanya `[{guildId, channelId}]` (tanpa token/data pribadi). File ini dan `*.tmp`-nya sudah masuk `.gitignore`. Guild ID dideteksi otomatis dari interaksi/event — tidak ada konfigurasi manual.
- `PERSIST_TARGETS=false`: tidak ada file yang ditulis sama sekali. Target hanya hidup di memori proses. Saat gateway pulih (`ShardReady`/`ShardResume`) dan setiap siklus watchdog, bot mengadopsi channel voice tempatnya berada (jika belum ada target) sebagai target di memori. Trade-off: setelah proses restart (Wispbyte sering restart), bot tidak tahu harus kembali ke room mana sampai user menjalankan `/join` lagi.

## autoDM dan registrasi command otomatis di server baru
- Saat bot ditambahkan ke server baru (`GuildCreate`), bot mengirim DM sambutan ke **admin yang menambahkan bot**, diambil dari audit log `BotAdd`. Fallback jika audit log tidak bisa dibaca atau tidak ditemukan: owner server. Fallback terakhir jika DM tertutup (error 50007): system channel server.
- Membaca audit log membutuhkan permission **View Audit Log** untuk role bot pada link undangan (contoh: `...?permissions=...&scope=bot%20applications.commands`). Tanpa izin itu, DM jatuh ke owner server. Tidak ada intent privileged tambahan yang dibutuhkan.
- Pada `GuildCreate` yang sama, bot otomatis mendaftarkan slash command ke guild baru (butuh env `CLIENT_ID`; jika kosong, proses dilewati dengan log warning). Daftar command dibagikan dari `commands.js` sehingga tidak duplikasi dengan `deploy-commands.js`.
- `autoDM/installingAppsOnServer.js` kini module (`registerInstallDM`) yang di-import `index.js` sebelum `client.login`; tidak ada proses/login client tambahan.
- `/status` menampilkan keadaan koneksi aktual, target, dan apakah upaya koneksi atau recovery sedang berjalan. Status proses yang benar-benar mati hanya bisa dipastikan dari panel/log hosting, bukan melalui slash command.
- `/leave` menghapus target, membatalkan timer recovery guild tersebut, dan menghentikan watchdog saat tidak ada target tersisa. Bot tidak akan masuk kembali ke channel tersebut sampai `/join` atau `/move` dijalankan lagi.
- Bot tidak menjamin uptime 100%. Pemulihan bergantung pada Discord, izin bot, ketersediaan filesystem target, dan konfigurasi restart Wispbyte.

Jalankan tes logika koneksi dengan `npm test`.

## Catatan
- Bot dibuat ringan dan cocok untuk hosting gratis atau server kecil.
- Fitur musik, streaming audio, dan dependency berat tidak termasuk dalam project ini.
- Command didaftarkan otomatis ke semua guild yang sedang bisa diakses bot.
