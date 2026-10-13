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

const READY_TIMEOUT_MS = 20000;
const WATCHDOG_INTERVAL_MS = 60000;
const DEFAULT_RETRY_DELAYS_MS = [2000, 5000, 10000, 30000, 60000];

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
        this.retryDelaysMs = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
        this.setTimer = options.setTimeout ?? setTimeout;
        this.clearTimer = options.clearTimeout ?? clearTimeout;
        this.setInterval = options.setInterval ?? setInterval;
        this.clearInterval = options.clearInterval ?? clearInterval;
        this.entries = new Map();
        this.closed = false;
        this.watchdogTimer = null;
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
            this.ensureWatchdog();
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
        this.ensureWatchdog();
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
        if (this.entries.size === 0) this.stopWatchdog();
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
            reconnecting: entry.reconnecting,
            lastError: entry.lastError
        };
    }

    ensureWatchdog() {
        if (this.watchdogTimer || this.closed || this.entries.size === 0) return;
        this.watchdogTimer = this.setInterval(() => {
            this.checkTargets().catch((error) => {
                this.errorLog("Watchdog voice gagal memeriksa target", error);
            });
        }, WATCHDOG_INTERVAL_MS);
        this.watchdogTimer.unref?.();
    }

    stopWatchdog() {
        if (!this.watchdogTimer) return;
        this.clearInterval(this.watchdogTimer);
        this.watchdogTimer = null;
    }

    async checkTargets() {
        if (this.closed) return;
        const attempts = [];
        for (const entry of this.entries.values()) {
            if (this.entries.get(entry.guildId) !== entry || entry.inFlight || entry.retryTimer) continue;
            const connection = this.voice.getVoiceConnection(entry.guildId);
            if (connection?.state?.status === this.voice.VoiceConnectionStatus.Ready &&
                connection.joinConfig?.channelId === entry.channelId) continue;
            attempts.push(this.attempt(entry, "watchdog mendeteksi koneksi tidak Ready"));
        }
        await Promise.all(attempts);
    }

    async reconnectTargets(reason = "gateway pulih") {
        if (this.closed) return;
        const attempts = [];
        for (const entry of this.entries.values()) {
            if (entry.inFlight) continue;
            this.cancelRecovery(entry);
            entry.reconnecting = false;
            const connection = this.voice.getVoiceConnection(entry.guildId);
            if (connection?.state?.status === this.voice.VoiceConnectionStatus.Ready &&
                connection.joinConfig?.channelId === entry.channelId) continue;
            attempts.push(this.attempt(entry, reason));
        }
        await Promise.all(attempts);
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
        if (this.entries.size === 0) this.stopWatchdog();
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

            let connection = this.voice.getVoiceConnection(entry.guildId) ?? entry.connection;
            const connectionMatchesTarget = connection?.joinConfig?.channelId === entry.channelId;
            if (connection?.state.status === this.voice.VoiceConnectionStatus.Ready && connectionMatchesTarget) {
                entry.connection = connection;
                this.attachConnection(entry, connection);
                this.markReady(entry, "koneksi sudah Ready");
                return { ready: true };
            }

            if (!this.isCurrent(entry, generation)) return { ready: false, cancelled: true };
            const registeredConnection = this.voice.getVoiceConnection(entry.guildId);
            const connectionsToDestroy = new Set([registeredConnection, entry.connection].filter(Boolean));
            for (const oldConnection of connectionsToDestroy) {
                this.detachConnection(entry, oldConnection, false);
                if (oldConnection.state.status !== this.voice.VoiceConnectionStatus.Destroyed) oldConnection.destroy();
            }
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
            syncNetworking(newState);
            if (newState.status === this.voice.VoiceConnectionStatus.Ready) {
                this.markReady(entry, "event Ready");
            } else if (newState.status === this.voice.VoiceConnectionStatus.Disconnected ||
                newState.status === this.voice.VoiceConnectionStatus.Destroyed) {
                if (this.entries.get(entry.guildId) === entry && !entry.inFlight) {
                    entry.failed = true;
                    entry.reconnecting = false;
                    entry.lastError = `Koneksi ${newState.status}; recovery otomatis berjalan`;
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
        let networking = null;
        let networkingStateChange = null;
        let networkingError = null;
        let networkingClose = null;
        let websocket = null;
        let websocketClose = null;
        const syncWebsocket = (state) => {
            const nextWebsocket = Reflect.get(state ?? {}, "ws");
            if (websocket === nextWebsocket) return;
            if (websocket && websocketClose) websocket.off("close", websocketClose);
            websocket = nextWebsocket;
            websocketClose = websocket ? (code) => {
                this.logger.warn(`[NET] ${new Date().toISOString()} Guild ${entry.guildId} voice websocket closed; code ${code}`);
            } : null;
            websocket?.on("close", websocketClose);
        };
        const syncNetworking = (state) => {
            const nextNetworking = Reflect.get(state ?? {}, "networking");
            if (networking !== nextNetworking) {
                if (networking) {
                    networking.off("stateChange", networkingStateChange);
                    networking.off("error", networkingError);
                    networking.off("close", networkingClose);
                }
                networking = nextNetworking;
                networkingStateChange = networking ? (oldNetworkState, newNetworkState) => {
                    this.logger.log(`[NET] ${new Date().toISOString()} Guild ${entry.guildId} ${oldNetworkState.code ?? oldNetworkState.status} -> ${newNetworkState.code ?? newNetworkState.status}`);
                    syncWebsocket(newNetworkState);
                } : null;
                networkingError = networking ? (error) => {
                    this.logger.error(`[NET] ${new Date().toISOString()} Guild ${entry.guildId} networking error: ${error?.message ?? String(error)}`);
                } : null;
                networkingClose = networking ? (code) => {
                    this.logger.warn(`[NET] ${new Date().toISOString()} Guild ${entry.guildId} voice networking closed; code ${code}`);
                } : null;
                networking?.on("stateChange", networkingStateChange);
                networking?.on("error", networkingError);
                networking?.on("close", networkingClose);
                if (networking) {
                    const networkState = networking.state;
                    this.logger.log(`[NET] ${new Date().toISOString()} Guild ${entry.guildId} networking ${networkState.code ?? networkState.status}`);
                    syncWebsocket(networkState);
                } else {
                    syncWebsocket(null);
                }
            } else if (networking) {
                syncWebsocket(networking.state);
            }
        };
        connection.on("stateChange", onStateChange);
        connection.on("error", onError);
        syncNetworking(connection.state);
        entry.listeners = {
            connection,
            onStateChange,
            onError,
            get networking() { return networking; },
            get networkingStateChange() { return networkingStateChange; },
            get networkingError() { return networkingError; },
            get networkingClose() { return networkingClose; },
            get websocket() { return websocket; },
            get websocketClose() { return websocketClose; }
        };
    }

    detachConnection(entry, connection, destroy) {
        if (!connection) return;
        const listeners = entry.listeners;
        if (listeners?.connection === connection) {
            connection.off("stateChange", listeners.onStateChange);
            connection.off("error", listeners.onError);
            listeners.networking?.off("stateChange", listeners.networkingStateChange);
            listeners.networking?.off("error", listeners.networkingError);
            listeners.networking?.off("close", listeners.networkingClose);
            listeners.websocket?.off("close", listeners.websocketClose);
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
        entry.retryIndex = 0;
        this.cancelRecovery(entry);
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
        if (this.retryDelaysMs.length === 0) {
            entry.reconnecting = false;
            return;
        }

        const delay = this.retryDelaysMs[Math.min(entry.retryIndex, this.retryDelaysMs.length - 1)];
        entry.retryIndex += 1;
        entry.reconnecting = true;
        entry.retryTimer = this.setTimer(() => {
            entry.retryTimer = null;
            if (this.entries.get(entry.guildId) !== entry || this.closed) return;
            this.attempt(entry, `recovery otomatis percobaan ${entry.retryIndex}`).catch((error) => {
                this.errorLog(`Recovery voice guild ${entry.guildId}`, error);
            });
        }, delay);
        entry.retryTimer.unref?.();
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
        this.stopWatchdog();
        for (const entry of this.entries.values()) this.disposeEntry(entry, true);
    }
}

module.exports = { VoiceManager };
