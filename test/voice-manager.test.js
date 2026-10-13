const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { ChannelType } = require("discord.js");
const { VoiceManager } = require("../voice-manager");

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
            if (!connection.ready) throw new Error("ready timeout");
            connection.transition(target);
            return connection;
        }
    };
    const manager = new VoiceManager(client, {
        voice,
        logger: { log() {}, error() {} },
        retryDelaysMs: [10, 20, 30],
        cooldownMs: 100,
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
        }
    });
    return {
        manager,
        channel,
        timers,
        savedTargets,
        get joinCalls() { return joinCalls; },
        async runNextTimer() {
            const [timer] = timers.keys();
            assert.ok(timer, "expected a scheduled retry");
            timers.delete(timer);
            timer.callback();
            await new Promise((resolve) => setImmediate(resolve));
            await new Promise((resolve) => setImmediate(resolve));
        }
    };
}

test("disconnect events never reconnect automatically; /join connects manually", async () => {
    const harness = createHarness();
    await harness.manager.setTarget("guild-1", "channel-1");
    const connection = harness.manager.entries.get("guild-1").connection;
    connection.transition("disconnected");

    assert.equal(harness.joinCalls, 1);
    assert.equal(harness.manager.status("guild-1").state, "failed");
    assert.equal(harness.timers.size, 0);

    const manualJoin = await harness.manager.setTarget("guild-1", "channel-1");

    assert.equal(manualJoin.ready, true);
    assert.equal(harness.joinCalls, 2);
    await harness.manager.close();
});

test("failed connection attempt stays failed until another manual /join", async () => {
    const harness = createHarness({ readiness: [false, true] });
    const first = await harness.manager.setTarget("guild-1", "channel-1");
    assert.equal(first.ready, false);
    assert.equal(harness.manager.status("guild-1").state, "failed");
    assert.equal(harness.timers.size, 0);

    const manualJoin = await harness.manager.setTarget("guild-1", "channel-1");

    assert.equal(manualJoin.ready, true);
    assert.equal(harness.manager.status("guild-1").state, "ready");
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

test("target without required permissions is discarded", async () => {
    const harness = createHarness({ allowed: false });

    const result = await harness.manager.setTarget("guild-1", "channel-1");

    assert.equal(result.invalid, true);
    assert.equal(harness.manager.status("guild-1").state, "no-target");
    assert.equal(harness.joinCalls, 0);
    assert.deepEqual(harness.savedTargets, []);
    await harness.manager.close();
});

test("startup loads saved target without making a voice connection", async () => {
    const harness = createHarness({ storedTargets: [{ guildId: "guild-1", channelId: "channel-1" }] });
    await harness.manager.restoreTargets();

    assert.equal(harness.manager.status("guild-1").state, "disconnected");
    assert.equal(harness.joinCalls, 0);
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
        clearTimeout: harness.manager.clearTimer
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
