const {
  Client,
  GatewayIntentBits,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  Events
} = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const rooms = new Map();
const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

function generateRoomCode() {
  return Math.random().toString(36).slice(2, 7).toUpperCase();
}

function normalizeWord(value) {
  return (value || '').trim().toLowerCase().replace(/[^a-z]/g, '');
}

function getRoomByCode(code) {
  return rooms.get(code?.toUpperCase?.() || code);
}

function getRoomInChannel(channelId) {
  for (const room of rooms.values()) {
    if (room.channelId === channelId) return room;
  }
  return null;
}

function nextLetter() {
  return letters[Math.floor(Math.random() * letters.length)];
}

function endRoom(code) {
  const room = rooms.get(code);
  if (!room) return;

  if (room.timer) {
    clearTimeout(room.timer);
  }

  rooms.delete(code);
}

function startRound(room) {
  room.currentLetter = nextLetter();
  room.usedWords = new Set();
  room.status = 'playing';
  room.roundStartedAt = Date.now();

  if (room.timer) clearTimeout(room.timer);

  room.timer = setTimeout(() => {
    const channel = client.channels.cache.get(room.channelId);
    if (channel) {
      channel.send(`⏰ Waktu habis! Hurufnya adalah **${room.currentLetter}**. Game selesai.`);
    }
    endRoom(room.code);
  }, 20000);

  const channel = client.channels.cache.get(room.channelId);
  if (channel) {
    channel.send(`🎮 Game dimulai! Huruf pertama: **${room.currentLetter}**\nJawab dengan kata yang dimulai huruf **${room.currentLetter}**. Waktu: **20 detik**. Nyawa: **2**`);
  }
}

function createRoom(hostUser, channelId) {
  const code = generateRoomCode();
  const room = {
    code,
    channelId,
    guildId: channelId ? null : null,
    hostId: hostUser.id,
    players: [{
      id: hostUser.id,
      username: hostUser.username,
      score: 0,
      lives: 2
    }],
    status: 'waiting',
    currentLetter: null,
    usedWords: new Set(),
    timer: null
  };

  rooms.set(code, room);
  return room;
}

function joinRoom(code, user, channelId) {
  const room = getRoomByCode(code);
  if (!room) {
    return { ok: false, message: 'Kode room tidak valid.' };
  }

  if (room.channelId !== channelId) {
    return { ok: false, message: 'Kamu harus join di channel yang sama dengan room.' };
  }

  if (room.players.length >= 6) {
    return { ok: false, message: 'Room sudah penuh.' };
  }

  const alreadyJoined = room.players.some((player) => player.id === user.id);
  if (alreadyJoined) {
    return { ok: false, message: 'Kamu sudah masuk room ini.' };
  }

  room.players.push({
    id: user.id,
    username: user.username,
    score: 0,
    lives: 2
  });

  return { ok: true, room };
}

client.on('ready', () => {
  console.log('Bot ready');
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === 'game') {
      const code = interaction.options.getString('code');
      const channelId = interaction.channelId;

      if (!code) {
        const room = createRoom(interaction.user, channelId);
        await interaction.reply({
          content: `🎮 Room baru dibuat! Kode: **${room.code}**\nMasuk room dengan /game ${room.code}\nMinimal 1-6 pemain.`,
          ephemeral: false
        });
        return;
      }

      const result = joinRoom(code, interaction.user, channelId);
      if (!result.ok) {
        await interaction.reply({ content: `❌ ${result.message}`, ephemeral: true });
        return;
      }

      const room = result.room;
      if (room.players.length >= 2 && room.status !== 'playing') {
        room.status = 'playing';
        startRound(room);
      }

      await interaction.reply({
        content: `✅ Kamu masuk ke room **${code}**. Total pemain: **${room.players.length}**`,
        ephemeral: false
      });
      return;
    }
  }

  if (interaction.isButton()) {
    if (interaction.customId === 'create_room') {
      const room = createRoom(interaction.user, interaction.channelId);
      await interaction.reply({
        content: `🎮 Room dibuat! Kode: **${room.code}**\nGunakan /game ${room.code} untuk join.`,
        ephemeral: true
      });
    }

    if (interaction.customId === 'join_room') {
      await interaction.reply({
        content: 'Masukkan kode room dengan `/game <kode>` di channel ini.',
        ephemeral: true
      });
    }
  }
});

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;

  if (message.content.startsWith('!join ')) {
    const code = message.content.split(' ')[1]?.toUpperCase();
    const room = getRoomByCode(code);

    if (!room) {
      message.reply('❌ Kode room tidak valid.');
      return;
    }

    if (room.channelId !== message.channelId) {
      message.reply('❌ Kamu harus join di channel yang sama.');
      return;
    }

    const result = joinRoom(code, message.author, message.channelId);
    if (!result.ok) {
      message.reply(`❌ ${result.message}`);
      return;
    }

    if (room.players.length >= 2 && room.status !== 'playing') {
      room.status = 'playing';
      startRound(room);
    }

    message.reply(`✅ Berhasil masuk room **${code}** (${room.players.length}/6)`);
    return;
  }

  if (message.content === '!room') {
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('create_room')
        .setLabel('Create Room')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('join_room')
        .setLabel('Join Room')
        .setStyle(ButtonStyle.Secondary)
    );

    await message.channel.send({
      content: 'Pilih menu room:',
      components: [row]
    });
    return;
  }

  const room = getRoomInChannel(message.channelId);
  if (!room || room.status !== 'playing') return;

  const player = room.players.find((p) => p.id === message.author.id);
  if (!player) return;

  const guess = normalizeWord(message.content);
  if (!guess) return;

  const valid = guess.startsWith(room.currentLetter.toLowerCase()) && !room.usedWords.has(guess);

  if (!valid) {
    player.lives -= 1;
    message.reply(`❌ Salah! Nyawa ${player.username} berkurang jadi **${player.lives}**.`);

    if (player.lives <= 0) {
      const remaining = room.players.filter((p) => p.lives > 0);
      room.players = remaining;
      message.reply(`💥 ${player.username} kalah dan keluar dari room.`);

      if (room.players.length <= 1) {
        const winner = room.players[0];
        message.channel.send(`🏆 Game selesai! Pemenang: **${winner ? winner.username : 'Tidak ada'}**`);
        endRoom(room.code);
      }
    }
    return;
  }

  room.usedWords.add(guess);
  player.score += 10;
  message.reply(`✅ Benar! **${message.author.username}** dapat +10 poin. Skor sekarang: **${player.score}**`);
  startRound(room);
});

client.login(process.env.DISCORD_TOKEN);