const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { ChannelType } = require("discord.js");
const { VoiceManager, isAlreadyInChannel } = require("../voice-manager");
const { findInviter, buildInstallMessage, registerInstallDM } = require("../autoDM/installingAppsOnServer");

class FakeConnection extends EventEmitter {
    constructor(options, ready) {
        super();
        this.options = options;
        this.joinConfig = { channelId: options.channelId };
        this.state = { status: "connecting" };
        this.rejoinAttempts = 5;
        this.ready = ready;
    }

    transition(status) {
        const oldState = this.state;
        this.state = { status };
        this.emit("stateChange", oldState, this.state);
    }

    rejoin() {
        return false;
    }

    destroy() {
        this.transition("destroyed");
    }
}

function createHarness({ readiness = [], allowed = true, storedTargets = [] } = {}) {
    const timers = new Map();
    const intervals = new Map();
    const savedTargets = structuredClone(storedTargets);
    const channel = {
        id: "channel-1",
        guildId: "guild-1",
        name: "voice",
        type: ChannelType.GuildVoice,
        permissionsFor: () => ({ has: () => allowed })
    };
    const guild = {
        id: "guild-1",
        voiceAdapterCreator: {},
        channels: {
            cache: new Map([[channel.id, channel]]),
            fetch: async (id) => channel.id === id ? channel : null
        },
        members: {
            me: {},
            fetchMe: async () => ({})
        }
    };
    const client = {
        guilds: {
            cache: new Map([[guild.id, guild]]),
            fetch: async (id) => id === guild.id ? guild : null
        }
    };
    const connections = new Map();
    let joinCalls = 0;
    const voice = {
        VoiceConnectionStatus: {
            Connecting: "connecting",
            Signalling: "signalling",
            Ready: "ready",
            Disconnected: "disconnected",
            Destroyed: "destroyed"
        },
        getVoiceConnection: (guildId) => connections.get(guildId),
        joinVoiceChannel: (options) => {
            joinCalls += 1;
            const connection = new FakeConnection(options, readiness.shift() ?? true);
            connections.set(options.guildId, connection);
            const destroy = connection.destroy.bind(connection);
            connection.destroy = () => {
                destroy();
                if (connections.get(options.guildId) === connection) connections.delete(options.guildId);
            };
            return connection;
        },
        entersState: async (connection, target) => {
            if (connection.state.status === target) return connection;
            if (target !== "ready") throw new Error("state timeout");
            if (!connection.ready) throw new Error("ready timeout");
            connection.transition(target);
            return connection;
        }
    };
    const manager = new VoiceManager(client, {
        voice,
        logger: { log() {}, warn() {}, error() {} },
        storage: {
            load: async () => structuredClone(savedTargets),
            save: (targets) => savedTargets.splice(0, savedTargets.length, ...structuredClone(targets))
        },
        setTimeout: (callback, delay) => {
            const timer = { callback, delay, cancelled: false };
            timers.set(timer, timer);
            return timer;
        },
        clearTimeout: (timer) => {
            timer.cancelled = true;
            timers.delete(timer);
        },
        setInterval: (callback, delay) => {
            const interval = { callback, delay, unreferenced: false, unref() { this.unreferenced = true; } };
            intervals.set(interval, interval);
            return interval;
        },
        clearInterval: (interval) => {
            intervals.delete(interval);
        }
    });
    return {
        manager,
        channel,
        timers,
        intervals,
        connections,
        savedTargets,
        setTimer: manager.setTimer,
        clearTimer: manager.clearTimer,
        setInterval: manager.setInterval,
        clearInterval: manager.clearInterval,
        get joinCalls() { return joinCalls; },
        async runNextTimer() {
            const [timer] = timers.keys();
            assert.ok(timer, "expected a scheduled retry");
            timers.delete(timer);
            timer.callback();
            const entry = manager.entries.get("guild-1");
            if (entry?.inFlight) await entry.inFlight;
            await new Promise((resolve) => setImmediate(resolve));
            await new Promise((resolve) => setImmediate(resolve));
        },
        async flush() {
            for (let i = 0; i < 10; i += 1) {
                await new Promise((resolve) => setImmediate(resolve));
            }
        }
    };
}

test("disconnect schedules one controlled recovery without duplicate connections", async () => {
    const harness = createHarness();
    await harness.manager.setTarget("guild-1", "channel-1");
    const connection = harness.manager.entries.get("guild-1").connection;
    connection.transition("disconnected");
    await harness.flush();

    assert.equal(harness.joinCalls, 1);
    assert.equal(harness.manager.status("guild-1").state, "connecting");
    assert.equal(harness.timers.size, 1);

    await harness.runNextTimer();

    assert.equal(harness.manager.status("guild-1").state, "ready");
    assert.equal(harness.joinCalls, 2);
    assert.equal(harness.timers.size, 0);
    await harness.manager.close();
});

test("failed recovery retries forever with an escalating capped backoff", async () => {
    const harness = createHarness({ readiness: Array(8).fill(false) });
    assert.equal(harness.manager.readyTimeoutMs, 20000);
    assert.deepEqual(harness.manager.retryDelaysMs, [2000, 5000, 10000, 30000, 60000]);
    const first = await harness.manager.setTarget("guild-1", "channel-1");
    assert.equal(first.ready, false);
    assert.equal(harness.manager.status("guild-1").state, "connecting");
    assert.equal(harness.timers.size, 1);

    const expectedDelays = [2000, 5000, 10000, 30000, 60000, 60000, 60000];
    for (const delay of expectedDelays) {
        assert.equal([...harness.timers.keys()][0].delay, delay);
        await harness.runNextTimer();
    }

    assert.equal(harness.joinCalls, 8);
    assert.equal(harness.timers.size, 1);
    assert.equal([...harness.timers.keys()][0].delay, 60000);
    assert.equal(harness.manager.status("guild-1").state, "connecting");
    await harness.manager.close();
});

test("gateway recovery and watchdog do not create duplicate guild connections", async () => {
    const harness = createHarness();
    await harness.manager.setTarget("guild-1", "channel-1");
    harness.manager.entries.get("guild-1").connection.transition("disconnected");

    await Promise.all([
        harness.manager.reconnectTargets("gateway resumed"),
        harness.manager.reconnectTargets("gateway resumed")
    ]);

    assert.equal(harness.joinCalls, 2);
    assert.equal(harness.connections.size, 1);
    assert.equal(harness.manager.status("guild-1").state, "ready");
    await harness.manager.close();
});

test("watchdog is unreferenced, reconnects restored targets, and stops on leave", async () => {
    const harness = createHarness({ storedTargets: [{ guildId: "guild-1", channelId: "channel-1" }] });
    await harness.manager.restoreTargets();
    const [watchdog] = harness.intervals.keys();

    assert.ok(watchdog);
    assert.equal(watchdog.delay, 60000);
    assert.equal(watchdog.unreferenced, true);
    await harness.manager.checkTargets();

    assert.equal(harness.joinCalls, 1);
    assert.equal(harness.manager.status("guild-1").state, "ready");
    await harness.manager.leave("guild-1");
    assert.equal(harness.intervals.size, 0);
    await harness.manager.close();
});

test("leave cancels pending recovery and join starts a new session", async () => {
    const harness = createHarness();
    await harness.manager.setTarget("guild-1", "channel-1");
    harness.manager.entries.get("guild-1").connection.transition("disconnected");
    await harness.flush();

    assert.equal(harness.timers.size, 1);
    await harness.manager.leave("guild-1");
    assert.equal(harness.timers.size, 0);
    assert.equal(harness.intervals.size, 0);
    assert.equal(harness.manager.status("guild-1").state, "no-target");

    const joined = await harness.manager.setTarget("guild-1", "channel-1");
    assert.equal(joined.ready, true);
    assert.equal(harness.joinCalls, 2);
    await harness.manager.close();
});

test("leave removes target and prevents later connection", async () => {
    const harness = createHarness();
    await harness.manager.setTarget("guild-1", "channel-1");

    await harness.manager.leave("guild-1");

    assert.equal(harness.manager.status("guild-1").state, "no-target");
    assert.equal(harness.timers.size, 0);
    assert.deepEqual(harness.savedTargets, []);
    await harness.manager.close();
});

test("move replaces the target and connects only to the requested channel", async () => {
    const harness = createHarness();
    await harness.manager.setTarget("guild-1", "channel-1");
    const newChannel = { ...harness.channel, id: "channel-new" };
    harness.manager.client.guilds.cache.get("guild-1").channels.cache.set(newChannel.id, newChannel);

    const moved = await harness.manager.setTarget("guild-1", newChannel.id);

    assert.equal(moved.ready, true);
    assert.equal(harness.manager.status("guild-1").channelId, "channel-new");
    assert.equal(harness.timers.size, 0);
    assert.deepEqual(harness.savedTargets, [{ guildId: "guild-1", channelId: "channel-new" }]);
    await harness.manager.close();
});

test("missing Connect permission keeps the target and schedules recovery", async () => {
    const harness = createHarness({ allowed: false });

    const result = await harness.manager.setTarget("guild-1", "channel-1");

    assert.notEqual(result.invalid, true);
    assert.equal(result.ready, false);
    assert.equal(harness.manager.status("guild-1").channelId, "channel-1");
    assert.equal(harness.manager.status("guild-1").state, "connecting");
    assert.equal(harness.joinCalls, 0);
    assert.equal(harness.timers.size, 1);
    assert.deepEqual(harness.savedTargets, [{ guildId: "guild-1", channelId: "channel-1" }]);
    await harness.manager.close();
});

test("permission loss during runtime keeps the target and does not destroy standby", async () => {
    const harness = createHarness();
    await harness.manager.setTarget("guild-1", "channel-1");
    const entry = harness.manager.entries.get("guild-1");
    harness.channel.permissionsFor = () => ({ has: () => false });
    entry.connection.transition("disconnected");
    await harness.flush();

    assert.equal(harness.manager.status("guild-1").channelId, "channel-1");
    assert.equal(harness.timers.size, 1);
    assert.deepEqual(harness.savedTargets, [{ guildId: "guild-1", channelId: "channel-1" }]);
    await harness.manager.close();
});

test("setTarget on the same channel while in flight reuses the attempt", async () => {
    const harness = createHarness();
    const first = harness.manager.setTarget("guild-1", "channel-1");
    const second = harness.manager.setTarget("guild-1", "channel-1");
    const [firstResult, secondResult] = await Promise.all([first, second]);

    assert.equal(harness.joinCalls, 1);
    assert.equal(harness.connections.size, 1);
    assert.equal(firstResult.ready, true);
    assert.equal(secondResult.ready, true);
    await harness.manager.close();
});

test("setTarget on the same channel during scheduled recovery does not restart the connection", async () => {
    const harness = createHarness({ readiness: [false, true] });
    const first = await harness.manager.setTarget("guild-1", "channel-1");
    assert.equal(first.ready, false);
    assert.equal(harness.timers.size, 1);

    const second = await harness.manager.setTarget("guild-1", "channel-1");

    assert.equal(second.ready, false);
    assert.equal(second.connecting, true);
    assert.equal(harness.timers.size, 1);
    assert.equal(harness.joinCalls, 1);
    await harness.manager.close();
});

test("setTarget on the same channel when already Ready returns ready without joining again", async () => {
    const harness = createHarness();
    await harness.manager.setTarget("guild-1", "channel-1");
    assert.equal(harness.joinCalls, 1);

    const again = await harness.manager.setTarget("guild-1", "channel-1");

    assert.equal(again.ready, true);
    assert.equal(harness.joinCalls, 1);
    await harness.manager.close();
});

test("isAlreadyInChannel treats a visible bot in the same channel as already there", () => {
    const connectingStatus = { state: "connecting", channelId: "channel-1" };
    assert.equal(isAlreadyInChannel(connectingStatus, "channel-1", "channel-1"), true);

    const readyStatus = { state: "ready", channelId: "channel-1" };
    assert.equal(isAlreadyInChannel(readyStatus, null, "channel-1"), true);

    const noTarget = { state: "no-target", channelId: null };
    assert.equal(isAlreadyInChannel(noTarget, "channel-1", "channel-1"), false);

    const otherChannel = { state: "ready", channelId: "channel-2" };
    assert.equal(isAlreadyInChannel(otherChannel, "channel-2", "channel-1"), false);
});

test("/join replies correctly when Meow is already in the user's voice channel", async () => {
    let loadedClient;
    class FakeClient {
        constructor() {
            this.handlers = new Map();
            loadedClient = this;
        }

        on(event, handler) {
            const handlers = this.handlers.get(event) ?? [];
            handlers.push(handler);
            this.handlers.set(event, handlers);
            return this;
        }

        once(event, handler) {
            return this.on(event, handler);
        }

        listeners(event) {
            return this.handlers.get(event) ?? [];
        }

        login() {
            return Promise.resolve();
        }

        destroy() {}
    }

    const interactionHandlerEvents = {
        ClientReady: "ready",
        ShardDisconnect: "shardDisconnect",
        ShardReconnecting: "shardReconnecting",
        ShardResume: "shardResume",
        ShardReady: "shardReady",
        Error: "error",
        Warn: "warn",
        ShardError: "shardError",
        ChannelDelete: "channelDelete",
        ChannelUpdate: "channelUpdate",
        GuildMemberUpdate: "guildMemberUpdate",
        GuildDelete: "guildDelete",
        InteractionCreate: "interactionCreate"
    };
    const fakeProcess = {
        env: {},
        exitCode: undefined,
        exit() {
            throw new Error("process.exit should not be called in this test");
        },
        once() {},
        on() {}
    };
    const fakeVoiceManager = {
        status: () => ({ state: "ready", channelId: "voice-1" }),
        close: async () => {}
    };
    const fakeDiscord = {
        Client: FakeClient,
        GatewayIntentBits: { Guilds: 1, GuildVoiceStates: 2 },
        Events: interactionHandlerEvents,
        ChannelType: { GuildVoice: "guildVoice" },
        MessageFlags: { Ephemeral: 64 },
        REST: class {},
        Routes: {}
    };
    const sandbox = {
        console: { log() {}, warn() {}, error() {} },
        process: fakeProcess,
        require(request) {
            if (request === "discord.js") return fakeDiscord;
            if (request === "@discordjs/voice") return { generateDependencyReport: () => "" };
            if (request === "./voice-manager") {
                return {
                    VoiceManager: class {
                        status = fakeVoiceManager.status;
                        close = fakeVoiceManager.close;
                    },
                    isAlreadyInChannel: () => true
                };
            }
            if (request === "./autoDM/installingAppsOnServer") return { registerInstallDM() {} };
            if (request === "./commands") return { commands: [] };
            if (request === "dotenv") return { config() {} };
            throw new Error(`Unexpected require: ${request}`);
        }
    };

    vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8"), sandbox, {
        filename: "index.js"
    });

    const client = loadedClient;
    const replies = [];
    const currentChannel = { id: "voice-1", name: "GOSYIPPP SYANTIKK", type: "guildVoice" };
    const member = { voice: { channel: currentChannel } };
    const interaction = {
        commandName: "join",
        guildId: "guild-1",
        user: { id: "user-1" },
        member,
        guild: {
            members: {
                me: { voice: { channelId: "voice-1" } },
                fetch: async () => member
            }
        },
        isChatInputCommand: () => true,
        reply: async (payload) => {
            replies.push(payload);
        }
    };

    const handler = [...client.handlers.values()].flat().at(-1);
    await handler(interaction);

    assert.equal(replies.length, 1);
    assert.equal(replies[0].content, "Mmm... kamu nggak lihat Meow ya? Meow sudah di sini, di **GOSYIPPP SYANTIKK**~ Jangan `/join` lagi, santai saja!");
    assert.equal(replies[0].flags, 64);
});

test("PERSIST_TARGETS=false keeps voice targets in memory and writes no file", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "meow-voice-nopersist-"));
    const storePath = path.join(directory, "voice-targets.json");
    const previous = process.env.PERSIST_TARGETS;
    process.env.PERSIST_TARGETS = "false";
    const harness = createHarness();
    const manager = new VoiceManager(harness.manager.client, {
        voice: harness.manager.voice,
        logger: { log() {}, warn() {}, error() {} },
        storePath,
        setTimeout: harness.manager.setTimer,
        clearTimeout: harness.manager.clearTimer,
        setInterval: harness.manager.setInterval,
        clearInterval: harness.manager.clearInterval
    });

    try {
        const joined = await manager.setTarget("guild-1", "channel-1");
        assert.equal(joined.ready, true);
        assert.equal(manager.status("guild-1").state, "ready");
        assert.equal(fs.existsSync(storePath), false);

        await manager.leave("guild-1");
        assert.equal(fs.existsSync(storePath), false);
        assert.deepEqual(fs.readdirSync(directory), []);
    } finally {
        await manager.close();
        if (previous === undefined) delete process.env.PERSIST_TARGETS;
        else process.env.PERSIST_TARGETS = previous;
        fs.rmSync(directory, { recursive: true, force: true });
        await harness.manager.close();
    }
});

const silentLogger = { log() {}, warn() {}, error() {} };

test("findInviter uses the BotAdd audit log entry for the bot", async () => {
    const executor = { id: "admin-1", tag: "Admin#0001" };
    const client = { user: { id: "bot-1" }, users: { fetch: async () => null } };
    let ownerFetched = false;
    const guild = {
        id: "guild-1",
        fetchAuditLogs: async () => ({
            entries: [{ target: { id: "bot-1" }, createdTimestamp: Date.now(), executor }]
        }),
        fetchOwner: async () => {
            ownerFetched = true;
            return { user: { id: "owner-1" } };
        }
    };

    const inviter = await findInviter(client, guild, { logger: silentLogger, delayMs: 0 });

    assert.equal(inviter, executor);
    assert.equal(ownerFetched, false);
});

test("findInviter falls back to the owner when the audit log is unavailable", async () => {
    const ownerUser = { id: "owner-1", tag: "Owner#0001" };
    const client = { user: { id: "bot-1" }, users: { fetch: async () => ownerUser } };
    const guild = {
        id: "guild-1",
        ownerId: "owner-1",
        fetchAuditLogs: async () => {
            throw new Error("Missing Access");
        },
        fetchOwner: async () => ({ user: ownerUser })
    };

    const inviter = await findInviter(client, guild, { logger: silentLogger, delayMs: 0 });

    assert.equal(inviter, ownerUser);
});

test("findInviter falls back to the owner when the audit entry is stale", async () => {
    const ownerUser = { id: "owner-1", tag: "Owner#0001" };
    const client = { user: { id: "bot-1" }, users: { fetch: async () => null } };
    const guild = {
        id: "guild-1",
        fetchAuditLogs: async () => ({
            entries: [{ target: { id: "bot-1" }, createdTimestamp: Date.now() - 300000, executor: { id: "old-1" } }]
        }),
        fetchOwner: async () => ({ user: ownerUser })
    };

    const inviter = await findInviter(client, guild, { logger: silentLogger, delayMs: 0 });

    assert.equal(inviter, ownerUser);
});

test("install DM template greets the recipient and lists every command", () => {
    const message = buildInstallMessage("Budi", "Server Uji");

    assert.ok(message.includes("Budi"));
    assert.ok(message.includes("Server Uji"));
    for (const name of ["/join", "/help", "/ping", "/move", "/say", "/status", "/about", "/leave", "/game"]) {
        assert.ok(message.includes(name), `template should mention ${name}`);
    }
});

test("GuildCreate registers commands even when inviter lookup throws", async () => {
    let guildCreateHandler;
    let onGuildJoinCalls = 0;
    let nameReads = 0;
    const client = {
        user: { id: "bot-1" },
        users: { fetch: async () => null },
        on: (event, handler) => {
            if (event === "guildCreate") guildCreateHandler = handler;
        }
    };
    const guild = {
        id: "guild-1",
        joinedTimestamp: Date.now(),
        ownerId: "owner-1",
        fetchAuditLogs: async () => ({ entries: [] }),
        fetchOwner: async () => null,
        get name() {
            nameReads += 1;
            if (nameReads === 1) throw new Error("simulated inviter lookup failure");
            return "Server Uji";
        },
        systemChannel: null
    };

    registerInstallDM(client, {
        onGuildJoin: async () => {
            onGuildJoinCalls += 1;
        }
    });
    await guildCreateHandler(guild);

    assert.equal(onGuildJoinCalls, 1);
});

test("GuildCreate still attempts DM when command registration throws", async () => {
    let guildCreateHandler;
    let dmAttempts = 0;
    const recipient = {
        id: "admin-1",
        username: "Admin",
        send: async () => {
            dmAttempts += 1;
        }
    };
    const client = {
        user: { id: "bot-1" },
        users: { fetch: async () => recipient },
        on: (event, handler) => {
            if (event === "guildCreate") guildCreateHandler = handler;
        }
    };
    const guild = {
        id: "guild-1",
        name: "Server Uji",
        joinedTimestamp: Date.now(),
        ownerId: "owner-1",
        fetchAuditLogs: async () => ({
            entries: [{ target: { id: "bot-1" }, createdTimestamp: Date.now(), executor: recipient }]
        }),
        systemChannel: null
    };

    registerInstallDM(client, {
        onGuildJoin: async () => {
            throw new Error("simulated command registration failure");
        }
    });
    await guildCreateHandler(guild);

    assert.equal(dmAttempts, 1);
});

test("startup loads saved target without making a voice connection", async () => {
    const harness = createHarness({ storedTargets: [{ guildId: "guild-1", channelId: "channel-1" }] });
    await harness.manager.restoreTargets();

    assert.equal(harness.manager.status("guild-1").state, "disconnected");
    assert.equal(harness.joinCalls, 0);
    await harness.manager.close();
});

test("startup auto-rejoins a valid saved target when enabled", async () => {
    const harness = createHarness({ storedTargets: [{ guildId: "guild-1", channelId: "channel-1" }] });

    await harness.manager.restoreTargets({ autoReconnect: true });

    assert.equal(harness.joinCalls, 1);
    assert.equal(harness.manager.status("guild-1").state, "ready");
    assert.equal(harness.timers.size, 0);
    await harness.manager.close();
});

test("deleting the target channel clears standby and retry", async () => {
    const harness = createHarness({ readiness: [true] });
    await harness.manager.setTarget("guild-1", "channel-1");

    await harness.manager.onChannelDeleted(harness.channel);

    assert.equal(harness.manager.status("guild-1").state, "no-target");
    assert.equal(harness.timers.size, 0);
    assert.deepEqual(harness.savedTargets, []);
    await harness.manager.close();
});

test("saved target waits for explicit /join and leave removes it from disk", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "meow-voice-test-"));
    const storePath = path.join(directory, "voice-targets.json");
    fs.writeFileSync(storePath, JSON.stringify([{ guildId: "guild-1", channelId: "channel-1" }]));
    const harness = createHarness();
    const manager = new VoiceManager(managerClient(harness), {
        voice: harness.manager.voice,
        logger: { log() {}, error() {} },
        storePath,
        setTimeout: harness.manager.setTimer,
        clearTimeout: harness.manager.clearTimer,
        setInterval: harness.manager.setInterval,
        clearInterval: harness.manager.clearInterval
    });

    try {
        await manager.restoreTargets();
        assert.equal(manager.status("guild-1").state, "disconnected");
        assert.equal(harness.joinCalls, 0);
        const manualJoin = await manager.setTarget("guild-1", "channel-1");
        assert.equal(manualJoin.ready, true);
        assert.equal(manager.status("guild-1").state, "ready");
        await manager.leave("guild-1");
        assert.deepEqual(JSON.parse(fs.readFileSync(storePath, "utf8")), []);
    } finally {
        await manager.close();
        fs.rmSync(directory, { recursive: true, force: true });
        await harness.manager.close();
    }
});

function managerClient(harness) {
    return harness.manager.client;
}
