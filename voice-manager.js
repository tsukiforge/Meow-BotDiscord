const fs = require("node:fs");
const path = require("node:path");
const {
    ChannelType,
    PermissionFlagsBits
} = require("discord.js");
const {
    joinVoiceChannel,
    getVoiceConnection,
    entersState,
    VoiceConnectionStatus
} = require("@discordjs/voice");

const READY_TIMEOUT_MS = 15000;

class VoiceManager {
    constructor(client, options = {}) {
        this.client = client;
        this.logger = options.logger ?? console;
        this.voice = options.voice ?? {
            joinVoiceChannel,
            getVoiceConnection,
            entersState,
            VoiceConnectionStatus
        };
        this.readyTimeoutMs = options.readyTimeoutMs ?? READY_TIMEOUT_MS;
        this.retryDelaysMs = options.retryDelaysMs ?? [1000, 2000, 5000, 10000];
        this.setTimer = options.setTimeout ?? setTimeout;
        this.clearTimer = options.clearTimeout ?? clearTimeout;
        this.entries = new Map();
        this.closed = false;
        this.storePath = options.storePath ?? path.join(process.cwd(), "voice-targets.json");
        this.storage = options.storage ?? {
            load: () => this.readTargets(),
            save: (targets) => this.writeTargets(targets)
        };
    }

    log(message) {
        this.logger.log(`[VOICE] ${new Date().toISOString()} ${message}`);
    }

    connectionLog(message) {
        this.logger.log(`[CONNECT] ${new Date().toISOString()} ${message}`);
    }

    errorLog(message, error) {
        const detail = error?.message ? `: ${error.message}` : "";
        this.logger.error(`[ERROR] ${new Date().toISOString()} ${message}${detail}`);
    }

    readTargets() {
        try {
            const parsed = JSON.parse(fs.readFileSync(this.storePath, "utf8"));
            if (!Array.isArray(parsed)) throw new Error("format target bukan array");
            return parsed.filter((target) =>
                target && typeof target.guildId === "string" && typeof target.channelId === "string"
            );
        } catch (error) {
            if (error.code !== "ENOENT") this.errorLog("Gagal membaca penyimpanan target voice", error);
            return [];
        }
    }

    writeTargets(targets) {
        const temporaryPath = `${this.storePath}.${process.pid}.tmp`;
        try {
            fs.writeFileSync(temporaryPath, JSON.stringify(targets, null, 2), { mode: 0o600 });
            fs.renameSync(temporaryPath, this.storePath);
        } catch (error) {
            try {
                fs.rmSync(temporaryPath, { force: true });
            } catch {}
            this.errorLog("Gagal menyimpan target voice", error);
        }
    }

    persistTargets() {
        const targets = [...this.entries.values()].map(({ guildId, channelId }) => ({ guildId, channelId }));
        try {
            this.storage.save(targets);
        } catch (error) {
            this.errorLog("Gagal menyimpan target voice", error);
        }
    }

    async restoreTargets({ autoReconnect = false } = {}) {
        let targets;
        try {
            targets = await this.storage.load();
        } catch (error) {
            this.errorLog("Gagal memuat target voice", error);
            return;
        }

        for (const target of targets) {
            if (!target?.guildId || !target?.channelId || this.closed) continue;
            const entry = this.createEntry(target.guildId, target.channelId);
            this.entries.set(entry.guildId, entry);
            if (autoReconnect) {
                this.logger.log(`[TARGET] ${new Date().toISOString()} Target ${entry.channelId} guild ${entry.guildId} dimuat; auto-rejoin dimulai`);
                const result = await this.attempt(entry, "pemulihan setelah restart");
                if (result.ready) {
                    this.logger.log(`[TARGET] ${new Date().toISOString()} Auto-rejoin guild ${entry.guildId} berhasil`);
                } else if (!result.invalid && !result.cancelled) {
                    this.logger.warn(`[TARGET] ${new Date().toISOString()} Auto-rejoin guild ${entry.guildId} belum berhasil; recovery terjadwal`);
                }
            } else {
                this.logger.log(`[TARGET] ${new Date().toISOString()} Target ${entry.channelId} guild ${entry.guildId} dimuat; menunggu /join manual`);
            }
        }
    }

    createEntry(guildId, channelId) {
        return {
            guildId,
            channelId,
            connection: null,
            listeners: null,
            reconnecting: false,
            failed: false,
            inFlight: null,
            retryTimer: null,
            retryIndex: 0,
            generation: 0,
            lastError: null
        };
    }

    async setTarget(guildId, channelId) {
        if (this.closed) throw new Error("Pengelola voice sedang dihentikan");
        const oldEntry = this.entries.get(guildId);
        if (oldEntry?.channelId === channelId) {
            this.cancelRecovery(oldEntry);
            oldEntry.failed = false;
            oldEntry.retryIndex = 0;
            return this.attempt(oldEntry, "target yang sama diminta kembali");
        }
        if (oldEntry) this.disposeEntry(oldEntry, true);

        const entry = this.createEntry(guildId, channelId);
        this.entries.set(guildId, entry);
        this.persistTargets();
        this.logger.log(`[TARGET] ${new Date().toISOString()} Guild ${guildId} diarahkan ke channel ${channelId}`);
        return this.attempt(entry, "target dipilih pengguna");
    }

    async leave(guildId) {
        const entry = this.entries.get(guildId);
        if (entry) {
            this.entries.delete(guildId);
            this.disposeEntry(entry, true);
        } else {
            const connection = this.voice.getVoiceConnection(guildId);
            if (connection && connection.state.status !== this.voice.VoiceConnectionStatus.Destroyed) {
                connection.destroy();
            }
        }
        this.persistTargets();
        this.logger.log(`[TARGET] ${new Date().toISOString()} Standby guild ${guildId} dinonaktifkan oleh pengguna`);
    }

    status(guildId) {
        const entry = this.entries.get(guildId);
        if (!entry) return { state: "no-target", channelId: null, reconnecting: false, lastError: null };

        const connection = entry.connection ?? this.voice.getVoiceConnection(guildId);
        const connectionStatus = connection?.state?.status ?? "NotConnected";
        const connectionMatchesTarget = connection?.joinConfig?.channelId === entry.channelId;
        return {
            state: connectionStatus === this.voice.VoiceConnectionStatus.Ready && connectionMatchesTarget
                ? "ready"
                : entry.reconnecting || Boolean(entry.inFlight) || Boolean(entry.retryTimer)
                        ? "connecting"
                        : entry.failed
                            ? "failed"
                            : "disconnected",
            connectionStatus,
            channelId: entry.channelId,
            connecting: entry.reconnecting || Boolean(entry.inFlight) || Boolean(entry.retryTimer),
            reconnecting: false,
            lastError: entry.lastError
        };
    }

    async getValidTarget(entry) {
        let guild = this.client.guilds.cache.get(entry.guildId);
        if (!guild) {
            try {
                guild = await this.client.guilds.fetch(entry.guildId);
            } catch (error) {
                if (error.code === 10004 || error.code === 10007) {
                    await this.invalidateTarget(entry, "guild tidak tersedia atau bot sudah keluar");
                    return null;
                }
                throw error;
            }
        }

        let channel = guild.channels.cache.get(entry.channelId);
        if (!channel) {
            try {
                channel = await guild.channels.fetch(entry.channelId);
            } catch (error) {
                if (error.code === 10003 || error.code === 50001) {
                    await this.invalidateTarget(entry, "channel tidak tersedia atau tidak dapat dilihat");
                    return null;
                }
                throw error;
            }
        }

        if (!channel || channel.type !== ChannelType.GuildVoice || channel.guildId !== entry.guildId) {
            await this.invalidateTarget(entry, "target bukan voice channel yang valid");
            return null;
        }

        const botMember = guild.members.me ?? await guild.members.fetchMe();
        const permissions = botMember && channel.permissionsFor(botMember);
        if (!permissions?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect])) {
            await this.invalidateTarget(entry, "izin View Channel atau Connect tidak tersedia");
            return null;
        }

        return { guild, channel };
    }

    async invalidateTarget(entry, reason) {
        if (this.entries.get(entry.guildId) !== entry) return;
        this.entries.delete(entry.guildId);
        this.disposeEntry(entry, true);
        this.persistTargets();
        this.logger.error(`[TARGET] ${new Date().toISOString()} Target ${entry.channelId} guild ${entry.guildId} dihentikan: ${reason}`);
    }

    attempt(entry, reason) {
        if (this.entries.get(entry.guildId) !== entry || this.closed) {
            return Promise.resolve({ ready: false, cancelled: true });
        }
        if (entry.inFlight) return entry.inFlight;

        entry.reconnecting = true;
        const generation = entry.generation;
        entry.inFlight = this.performAttempt(entry, reason, generation)
            .then((result) => {
                entry.inFlight = null;
                if (this.entries.get(entry.guildId) === entry && generation === entry.generation) {
                    entry.reconnecting = false;
                    if (!result.ready && !result.cancelled) entry.failed = true;
                    if (!result.ready && !result.cancelled && !result.invalid) {
                        this.scheduleRecovery(entry);
                    }
                }
                return result;
            });
        return entry.inFlight;
    }

    async performAttempt(entry, reason, generation) {
        this.connectionLog(`${reason}; target ${entry.channelId}, guild ${entry.guildId}`);
        try {
            const target = await this.getValidTarget(entry);
            if (!target || !this.isCurrent(entry, generation)) return { ready: false, invalid: true };

            let connection = entry.connection ?? this.voice.getVoiceConnection(entry.guildId);
            const connectionMatchesTarget = connection?.joinConfig?.channelId === entry.channelId;
            if (connection?.state.status === this.voice.VoiceConnectionStatus.Ready && connectionMatchesTarget) {
                entry.connection = connection;
                this.attachConnection(entry, connection);
                this.markReady(entry, "koneksi sudah Ready");
                return { ready: true };
            }

            if (connection && connectionMatchesTarget && connection.state.status !== this.voice.VoiceConnectionStatus.Destroyed) {
                entry.connection = connection;
                this.attachConnection(entry, connection);
            }

            if (connection && connectionMatchesTarget && [
                this.voice.VoiceConnectionStatus.Connecting,
                this.voice.VoiceConnectionStatus.Signalling
            ].includes(connection.state.status)) {
                try {
                    await this.voice.entersState(connection, this.voice.VoiceConnectionStatus.Ready, this.readyTimeoutMs);
                    if (this.isCurrent(entry, generation)) {
                        entry.connection = connection;
                        this.markReady(entry, "koneksi mencapai Ready");
                        return { ready: true };
                    }
                    return { ready: false, cancelled: true };
                } catch (error) {
                    entry.lastError = error.message;
                    this.connectionLog(`Koneksi ${connection.state.status} tidak mencapai Ready; percobaan manual membuat koneksi baru`);
                }
            }

            if (!this.isCurrent(entry, generation)) return { ready: false, cancelled: true };
            if (connection) this.detachConnection(entry, connection, true);
            connection = this.voice.joinVoiceChannel({
                channelId: target.channel.id,
                guildId: entry.guildId,
                adapterCreator: target.guild.voiceAdapterCreator,
                selfDeaf: true,
                selfMute: true
            });
            entry.connection = connection;
            this.attachConnection(entry, connection);
            await this.voice.entersState(connection, this.voice.VoiceConnectionStatus.Ready, this.readyTimeoutMs);

            if (!this.isCurrent(entry, generation)) {
                this.detachConnection(entry, connection, true);
                return { ready: false, cancelled: true };
            }
            this.markReady(entry, "koneksi baru mencapai Ready");
            return { ready: true };
        } catch (error) {
            if (!this.isCurrent(entry, generation)) return { ready: false, cancelled: true };
            entry.lastError = error.message;
            this.errorLog(`Koneksi manual guild ${entry.guildId}, channel ${entry.channelId}`, error);
            return { ready: false, error };
        }
    }

    isCurrent(entry, generation) {
        return !this.closed && this.entries.get(entry.guildId) === entry && entry.generation === generation;
    }

    attachConnection(entry, connection) {
        if (entry.listeners?.connection === connection) return;
        if (entry.listeners) this.detachConnection(entry, entry.listeners.connection, false);
        const onStateChange = (oldState, newState) => {
            this.log(`Guild ${entry.guildId} ${oldState.status} -> ${newState.status}`);
            if (newState.status === this.voice.VoiceConnectionStatus.Ready) {
                this.markReady(entry, "event Ready");
            } else if (newState.status === this.voice.VoiceConnectionStatus.Disconnected ||
                newState.status === this.voice.VoiceConnectionStatus.Destroyed) {
                if (this.entries.get(entry.guildId) === entry && !entry.inFlight) {
                    entry.failed = true;
                    entry.reconnecting = false;
                    entry.lastError = `Koneksi ${newState.status}; jalankan /join untuk menyambungkan kembali`;
                    this.log(`Guild ${entry.guildId} terputus; recovery terjadwal`);
                    if (newState.status === this.voice.VoiceConnectionStatus.Disconnected) {
                        this.detachConnection(entry, connection, true);
                    }
                    this.scheduleRecovery(entry);
                }
            }
        };
        const onError = (error) => {
            this.errorLog(`Voice connection guild ${entry.guildId}`, error);
            entry.lastError = error.message;
            if (this.entries.get(entry.guildId) === entry && !entry.inFlight &&
                connection.state.status !== this.voice.VoiceConnectionStatus.Ready) {
                entry.failed = true;
                this.scheduleRecovery(entry);
            }
        };
        connection.on("stateChange", onStateChange);
        connection.on("error", onError);
        entry.listeners = { connection, onStateChange, onError };
    }

    detachConnection(entry, connection, destroy) {
        if (!connection) return;
        const listeners = entry.listeners;
        if (listeners?.connection === connection) {
            connection.off("stateChange", listeners.onStateChange);
            connection.off("error", listeners.onError);
            entry.listeners = null;
        }
        if (destroy && connection.state.status !== this.voice.VoiceConnectionStatus.Destroyed) {
            connection.destroy();
        }
        if (entry.connection === connection) entry.connection = null;
    }

    markReady(entry, reason) {
        if (this.entries.get(entry.guildId) !== entry) return;
        entry.failed = false;
        entry.reconnecting = false;
        entry.lastError = null;
        this.connectionLog(`${reason}; guild ${entry.guildId} terhubung ke ${entry.channelId}`);
    }

    disposeEntry(entry, destroyConnection) {
        entry.generation += 1;
        this.cancelRecovery(entry);
        const connection = entry.connection ?? this.voice.getVoiceConnection(entry.guildId);
        if (connection) this.detachConnection(entry, connection, destroyConnection);
        entry.reconnecting = false;
    }

    cancelRecovery(entry) {
        if (entry.retryTimer) {
            this.clearTimer(entry.retryTimer);
            entry.retryTimer = null;
        }
    }

    scheduleRecovery(entry) {
        if (this.closed || this.entries.get(entry.guildId) !== entry || entry.retryTimer || entry.inFlight) return;
        const delay = this.retryDelaysMs[entry.retryIndex];
        if (delay === undefined) {
            entry.reconnecting = false;
            return;
        }

        entry.retryIndex += 1;
        entry.reconnecting = true;
        entry.retryTimer = this.setTimer(() => {
            entry.retryTimer = null;
            if (this.entries.get(entry.guildId) !== entry || this.closed) return;
            this.attempt(entry, `recovery otomatis percobaan ${entry.retryIndex}`).catch((error) => {
                this.errorLog(`Recovery voice guild ${entry.guildId}`, error);
            });
        }, delay);
        this.log(`Guild ${entry.guildId} recovery dijadwalkan dalam ${delay}ms`);
    }

    async onChannelDeleted(channel) {
        const entry = [...this.entries.values()].find((item) => item.channelId === channel.id);
        if (entry) await this.invalidateTarget(entry, "channel dihapus");
    }

    async onChannelUpdated(channel) {
        const entry = [...this.entries.values()].find((item) => item.channelId === channel.id);
        if (entry && this.entries.get(entry.guildId) === entry) {
            const target = await this.getValidTarget(entry);
            if (target) this.log(`Target ${entry.channelId} tetap valid setelah perubahan channel`);
        }
    }

    async onGuildMemberUpdated(guildId) {
        const entry = this.entries.get(guildId);
        if (!entry) return;
        const target = await this.getValidTarget(entry);
        if (target) this.log(`Izin bot untuk target ${entry.channelId} masih tersedia`);
    }

    async onGuildDeleted(guildId) {
        const entry = this.entries.get(guildId);
        if (entry) await this.invalidateTarget(entry, "bot dikeluarkan dari server");
    }

    async close() {
        this.closed = true;
        for (const entry of this.entries.values()) this.disposeEntry(entry, true);
    }
}

module.exports = { VoiceManager };
