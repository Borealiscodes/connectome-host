/**
 * Phase 2 smoke test for FleetModule.
 *
 * Drives the module's tool surface directly (no full framework needed) and
 * exercises the end-to-end loop:
 *   launch -> ready, list, status, command (/help, offline-safe), peek
 *   shows command-output events, kill exits the child cleanly.
 *
 * fleet--send is intentionally NOT tested here — it triggers inference and
 * needs a real ANTHROPIC_API_KEY.  That's manual-test territory.
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync, existsSync, mkdirSync, lstatSync, readFileSync, readlinkSync, symlinkSync, renameSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FleetModule } from '../src/modules/fleet-module.js';

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(TEST_DIR, '..');
const INDEX_PATH = join(REPO_ROOT, 'src', 'index.ts');

const MINIMAL_RECIPE = {
  name: 'Fleet Smoke Test',
  agent: { name: 'leaf', systemPrompt: 'never asked to infer in this test' },
  modules: { subagents: false, lessons: false, retrieval: false, wake: false, workspace: false },
};

async function waitFor(check: () => boolean, timeoutMs: number, label: string): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms: ${label}`);
}

describe('FleetModule — unresolved launch artifacts', () => {
  let tmpDir: string;
  const fleets: FleetModule[] = [];
  beforeAll(() => { tmpDir = mkdtempSync(join(tmpdir(), 'fkm-fleet-guard-')); });
  afterAll(async () => {
    await Promise.all(fleets.map((fleet) => fleet.stop()));
    rmSync(tmpDir, { recursive: true, force: true });
  }, 15_000);

  function makeFleet() {
    const fleet = new FleetModule({
      childIndexPath: join(TEST_DIR, 'mock-headless-child.ts'),
      socketWaitTimeoutMs: 5_000, readyTimeoutMs: 5_000,
      gracefulShutdownMs: 1_000, sigtermEscalationMs: 500,
    });
    fleets.push(fleet);
    return fleet;
  }
  function launch(fleet: FleetModule, dataDir: string) {
    return fleet.handleToolCall({ id: 'guard-launch', name: 'launch', input: {
      name: 'guard', recipe: 'mock-recipe', dataDir,
    } });
  }
  async function startOwner(dataDir: string, autoRestart = false,
    ctx = {} as Parameters<FleetModule['start']>[0]) {
    const fleet = new FleetModule({
      childIndexPath: join(TEST_DIR, 'mock-headless-child.ts'),
      socketWaitTimeoutMs: 5_000, readyTimeoutMs: 5_000,
      gracefulShutdownMs: 1_000, sigtermEscalationMs: 500,
      autoStart: [{ name: 'guard', recipe: 'mock-recipe', dataDir, autoRestart,
        env: { ANTHROPIC_API_KEY: 'sk-test-fleet-guard', ANTHROPIC_BASE_URL: 'http://127.0.0.1:1' } }],
    });
    fleets.push(fleet);
    await fleet.start(ctx);
    await waitFor(() => fleet.getChildren().get('guard')?.status === 'ready', 10_000, 'mock child ready');
    return fleet;
  }

  for (const artifact of ['headless.pid', 'ipc.sock']) {
    for (const kind of ['file', 'dangling symlink', 'FIFO', 'directory']) {
      test(`refuses unknown ${artifact} ${kind} without touching it`, async () => {
        const dataDir = mkdtempSync(join(tmpDir, 'unknown-'));
        const path = join(dataDir, artifact);
        if (kind === 'file') writeFileSync(path, 'unknown artifact bytes');
        if (kind === 'dangling symlink') symlinkSync('missing-target', path);
        if (kind === 'FIFO') execFileSync('mkfifo', [path]);
        if (kind === 'directory') mkdirSync(path);
        const before = lstatSync(path);
        const fleet = makeFleet();
        const result = await launch(fleet, dataDir);
        expect(result.success).toBe(false);
        expect(result.isError).toBe(true);
        expect(result.error).toContain('reconcile');
        expect(fleet.getChildren().size).toBe(0);
        expect(existsSync(join(dataDir, 'startup.log'))).toBe(false);
        const after = lstatSync(path);
        expect(after.ino).toBe(before.ino);
        expect(after.mode).toBe(before.mode);
        expect(after.mtimeMs).toBe(before.mtimeMs);
        if (kind === 'file') expect(readFileSync(path, 'utf8')).toBe('unknown artifact bytes');
        if (kind === 'dangling symlink') expect(readlinkSync(path)).toBe('missing-target');
      });
    }
  }

  test('non-ENOENT inspection failure refuses launch', async () => {
    const dataDir = join(tmpDir, 'not-a-directory');
    writeFileSync(dataDir, 'unchanged');
    const fleet = makeFleet();
    const result = await launch(fleet, dataDir);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Cannot inspect launch artifact');
    expect(fleet.getChildren().size).toBe(0);
    expect(readFileSync(dataDir, 'utf8')).toBe('unchanged');
  });

  test('fresh parent refuses an occupied dataDir and preserves the owner connection', async () => {
    const dataDir = join(tmpDir, 'occupied');
    const owner = await startOwner(dataDir);
    const child = owner.getChildren().get('guard')!;
    const pidFile = readFileSync(join(dataDir, 'headless.pid'), 'utf8');
    const socketInode = lstatSync(child.socketPath).ino;
    const log = readFileSync(join(dataDir, 'startup.log'), 'utf8');
    const stranger = makeFleet();
    await stranger.start({} as Parameters<FleetModule['start']>[0]);
    expect((await launch(stranger, dataDir)).success).toBe(false);
    expect(stranger.getChildren().size).toBe(0);
    expect(readFileSync(join(dataDir, 'headless.pid'), 'utf8')).toBe(pidFile);
    expect(lstatSync(child.socketPath).ino).toBe(socketInode);
    expect(readFileSync(join(dataDir, 'startup.log'), 'utf8')).toBe(log);
    expect(child.process?.exitCode).toBeNull();
    expect(child.process?.signalCode).toBeNull();
    const count = child.events.length;
    expect((await owner.handleToolCall({ id: 'owner-help', name: 'command',
      input: { name: 'guard', command: '/help' } })).success).toBe(true);
    await waitFor(() => child.events.slice(count).some((e) => e.type === 'command-output'),
      3_000, 'original owner still receives output');
    expect((await launch(owner, dataDir)).error).toContain('already ready');
    await owner.stop();
  }, 20_000);

  test('historical crashed record with no ChildProcess cannot authorize cleanup', async () => {
    let state: unknown = null;
    const ctx = {
      setState: (value: unknown) => { state = value; },
      getState: () => state,
      pushEvent: () => {}, getModule: () => null,
    } as unknown as Parameters<FleetModule['start']>[0];
    const dataDir = join(tmpDir, 'historical');
    const owner = await startOwner(dataDir, false, ctx);
    const old = owner.getChildren().get('guard')!;
    await owner.handleToolCall({ id: 'historical-crash', name: 'command',
      input: { name: 'guard', command: '/crash' } });
    await waitFor(() => old.exitedAt !== null && old.process?.exitCode === 1, 5_000, 'historical exit');
    const pidFile = readFileSync(join(dataDir, 'headless.pid'), 'utf8');
    const socketInode = lstatSync(old.socketPath).ino;
    const log = readFileSync(join(dataDir, 'startup.log'), 'utf8');
    const restored = makeFleet();
    await restored.start(ctx);
    expect(restored.getChildren().get('guard')?.process).toBeNull();
    expect((await launch(restored, dataDir)).success).toBe(false);
    expect(readFileSync(join(dataDir, 'headless.pid'), 'utf8')).toBe(pidFile);
    expect(lstatSync(old.socketPath).ino).toBe(socketInode);
    expect(readFileSync(join(dataDir, 'startup.log'), 'utf8')).toBe(log);
    await owner.stop();
    await restored.stop();
  }, 15_000);

  test('reaped handle cannot clean artifacts from a different generation', async () => {
    const dataDir = mkdtempSync(join(tmpDir, 'new-generation-'));
    const owner = await startOwner(dataDir);
    const old = owner.getChildren().get('guard')!;
    await owner.handleToolCall({ id: 'generation-crash', name: 'command', input: { name: 'guard', command: '/crash' } });
    await waitFor(() => old.exitedAt !== null && old.process?.exitCode === 1, 5_000, 'old generation exit');
    // A different live generation's PID replaces our reaped child's metadata.
    writeFileSync(join(dataDir, 'headless.pid'), String(process.pid));
    const inode = lstatSync(old.socketPath).ino;
    const startup = readFileSync(join(dataDir, 'startup.log'), 'utf8');
    expect((await launch(owner, dataDir)).success).toBe(false);
    expect(readFileSync(join(dataDir, 'headless.pid'), 'utf8')).toBe(String(process.pid));
    expect(lstatSync(old.socketPath).ino).toBe(inode);
    expect(readFileSync(join(dataDir, 'startup.log'), 'utf8')).toBe(startup);
    expect(owner.getChildren().get('guard')).toBe(old);
    await owner.stop();
  }, 15_000);

  test('reaped handle preserves a replacement live socket even with the old PID file', async () => {
    const dataDir = mkdtempSync(join(tmpDir, 'replaced-socket-'));
    const owner = await startOwner(dataDir);
    const old = owner.getChildren().get('guard')!;
    await owner.handleToolCall({ id: 'socket-generation-crash', name: 'command', input: { name: 'guard', command: '/crash' } });
    await waitFor(() => old.exitedAt !== null && old.process?.exitCode === 1, 5_000, 'old socket owner exit');
    const pid = readFileSync(join(dataDir, 'headless.pid'), 'utf8');
    const startup = readFileSync(join(dataDir, 'startup.log'), 'utf8');
    // Preserve the original inode and bind a different live server to its path,
    // reproducing a replacement runtime whose PID-file write failed.
    renameSync(old.socketPath, old.socketPath + '.retained');
    const server = createServer(socket => socket.end('replacement-owner'));
    try {
      await new Promise<void>((ok, no) => { server.once('error', no); server.listen(old.socketPath, ok); });
      const inode = lstatSync(old.socketPath).ino;
      expect((await launch(owner, dataDir)).success).toBe(false);
      expect(readFileSync(join(dataDir, 'headless.pid'), 'utf8')).toBe(pid);
      expect(lstatSync(old.socketPath).ino).toBe(inode);
      expect(readFileSync(join(dataDir, 'startup.log'), 'utf8')).toBe(startup);
      expect(owner.getChildren().get('guard')).toBe(old);
      expect(server.listening).toBe(true);
    } finally {
      await owner.stop();
      if(server.listening) await new Promise<void>((ok, no) => server.close(err => err ? no(err) : ok()));
    }
  }, 15_000);

  for (const failure of ['dead persisted PID', 'adoption PID mismatch']) {
    test(`restored parent preserves replacement artifacts after ${failure}`, async () => {
      let state: any;
      const ownerCtx = { setState: (value: unknown) => { state = value; }, getState: () => state,
        pushEvent: () => {}, getModule: () => null } as unknown as Parameters<FleetModule['start']>[0];
      const dataDir = mkdtempSync(join(tmpDir, 'restore-replacement-'));
      const owner = await startOwner(dataDir, false, ownerCtx);
      const old = owner.getChildren().get('guard')!;
      const persisted = JSON.parse(JSON.stringify(state)); // Last ready state before parent crash.
      await owner.handleToolCall({ id: 'restore-crash', name: 'command', input: { name: 'guard', command: '/crash' } });
      await waitFor(() => old.exitedAt !== null && old.process?.exitCode === 1, 5_000, 'persisted owner exit');
      if (failure === 'adoption PID mismatch') persisted.children.guard.pid = process.pid;
      const pidFile = readFileSync(join(dataDir, 'headless.pid'), 'utf8');
      const startup = readFileSync(join(dataDir, 'startup.log'), 'utf8');
      renameSync(old.socketPath, old.socketPath + '.retained');
      const server = createServer(socket => {
        socket.on('error', () => {});
        socket.write(JSON.stringify({ type: 'lifecycle', phase: 'ready', pid: old.pid }) + '\n');
      });
      const restored = makeFleet();
      try {
        await new Promise<void>((ok, no) => { server.once('error', no); server.listen(old.socketPath, ok); });
        const inode = lstatSync(old.socketPath).ino;
        const restoredCtx = { ...ownerCtx, getState: () => persisted, setState: () => {} };
        await restored.start(restoredCtx);
        expect(readFileSync(join(dataDir, 'headless.pid'), 'utf8')).toBe(pidFile);
        expect(lstatSync(old.socketPath).ino).toBe(inode);
        expect(restored.getChildren().get('guard')?.status).toBe('crashed');
        expect((await launch(restored, dataDir)).success).toBe(false);
        expect(readFileSync(join(dataDir, 'startup.log'), 'utf8')).toBe(startup);
        expect(server.listening).toBe(true);
      } finally {
        await restored.stop(); await owner.stop();
        if (server.listening) await new Promise<void>((ok, no) => server.close(err => err ? no(err) : ok()));
      }
    }, 15_000);
  }

  for (const mode of ['manual launch', 'restart', 'autoRestart']) {
    test(`reaped same-owner crash supports ${mode}`, async () => {
      const dataDir = mkdtempSync(join(tmpDir, 'crash-'));
      const owner = await startOwner(dataDir, mode === 'autoRestart');
      const old = owner.getChildren().get('guard')!;
      await owner.handleToolCall({ id: 'crash', name: 'command', input: { name: 'guard', command: '/crash' } });
      await waitFor(() => old.exitedAt !== null && old.process?.exitCode === 1, 5_000, 'owner observes exit');
      expect(existsSync(join(dataDir, 'headless.pid'))).toBe(true);
      // A fresh Fleet has no cleanup authority, even after the child is dead.
      expect((await launch(makeFleet(), dataDir)).success).toBe(false);
      if (mode === 'manual launch') expect((await launch(owner, dataDir)).success).toBe(true);
      if (mode === 'restart') expect((await owner.handleToolCall({ id: 'restart', name: 'restart',
        input: { name: 'guard' } })).success).toBe(true);
      await waitFor(() => {
        const next = owner.getChildren().get('guard');
        return next?.status === 'ready' && next.pid !== old.pid;
      }, 10_000, 'new child ready');
      const next = owner.getChildren().get('guard')!;
      expect(readFileSync(join(dataDir, 'headless.pid'), 'utf8')).toBe(String(next.pid));
      expect((await owner.handleToolCall({ id: 'graceful-restart', name: 'restart',
        input: { name: 'guard' } })).success).toBe(true);
      await owner.stop();
    }, 25_000);
  }
});

describe('FleetModule — Phase 2', () => {
  let tmpDir: string;
  let recipePath: string;
  let dataDir: string;
  let fleet: FleetModule;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'fkm-fleet-'));
    recipePath = join(tmpDir, 'recipe.json');
    dataDir = join(tmpDir, 'leaf');
    writeFileSync(recipePath, JSON.stringify(MINIMAL_RECIPE), 'utf-8');

    // Inject a dummy ANTHROPIC_API_KEY into the env that children inherit;
    // they validate it on startup but never call the API in this test.
    process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'sk-test-fleet-smoke';

    fleet = new FleetModule({
      childIndexPath: INDEX_PATH,
      // Snappier timeouts for a hermetic test.
      socketWaitTimeoutMs: 15_000,
      readyTimeoutMs: 10_000,
      gracefulShutdownMs: 5_000,
      sigtermEscalationMs: 2_000,
    });
  });

  afterAll(async () => {
    // Defensive cleanup — kill any children the test left behind.
    try { await fleet.stop(); } catch { /* noop */ }
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* noop */ }
  });

  test('launch → list → status → command/peek → kill round trip', async () => {
    // -- launch --
    const spawnRes = await fleet.handleToolCall({
      id: 't-launch',
      name: 'launch',
      input: { name: 'leaf', recipe: recipePath, dataDir },
    });
    expect(spawnRes.success).toBe(true);
    const spawnData = spawnRes.data as { name: string; pid: number | null; status: string };
    expect(spawnData.name).toBe('leaf');
    expect(spawnData.status).toBe('ready');
    expect(typeof spawnData.pid).toBe('number');

    // -- list --
    const listRes = await fleet.handleToolCall({ id: 't-list', name: 'list', input: {} });
    expect(listRes.success).toBe(true);
    const listData = listRes.data as Array<{ name: string; status: string; eventCount: number }>;
    expect(listData).toHaveLength(1);
    expect(listData[0]!.name).toBe('leaf');
    expect(listData[0]!.status).toBe('ready');

    // -- status --
    const statusRes = await fleet.handleToolCall({ id: 't-status', name: 'status', input: { name: 'leaf' } });
    expect(statusRes.success).toBe(true);
    const statusData = statusRes.data as { name: string; status: string; subscription: string[] };
    expect(statusData.status).toBe('ready');
    expect(statusData.subscription).toContain('*');  // default subscription

    // -- command (/help is offline-safe — no LLM call) --
    const cmdRes = await fleet.handleToolCall({
      id: 't-cmd',
      name: 'command',
      input: { name: 'leaf', command: '/help' },
    });
    expect(cmdRes.success).toBe(true);

    // Wait for the command-output events to land in the buffer.
    await waitFor(
      () => {
        const child = fleet.getChildren().get('leaf');
        return !!child && child.events.filter((e) => e.type === 'command-output').length >= 5;
      },
      5_000,
      'command-output events from /help',
    );

    // -- peek --
    const peekRes = await fleet.handleToolCall({
      id: 't-peek',
      name: 'peek',
      input: { name: 'leaf', lines: 30 },
    });
    expect(peekRes.success).toBe(true);
    const peekData = peekRes.data as { name: string; count: number; events: Array<{ type: string }> };
    expect(peekData.name).toBe('leaf');
    expect(peekData.count).toBeGreaterThan(0);
    const cmdOutputs = peekData.events.filter((e) => e.type === 'command-output');
    expect(cmdOutputs.length).toBeGreaterThanOrEqual(5);

    // -- kill --
    const killRes = await fleet.handleToolCall({ id: 't-kill', name: 'kill', input: { name: 'leaf' } });
    expect(killRes.success).toBe(true);

    // Final status should be 'exited' (graceful shutdown via socket).
    const child = fleet.getChildren().get('leaf');
    expect(child?.status).toBe('exited');
    expect(child?.exitCode).toBe(0);

    // Socket file should be removed by the child's own cleanup path.
    expect(existsSync(join(dataDir, 'ipc.sock'))).toBe(false);
  }, 60_000);

  test('launch rejects duplicate name while child is running', async () => {
    const dataDir2 = join(tmpDir, 'duplicate');
    const first = await fleet.handleToolCall({
      id: 't-dup-1',
      name: 'launch',
      input: { name: 'dup', recipe: recipePath, dataDir: dataDir2 },
    });
    expect(first.success).toBe(true);

    const second = await fleet.handleToolCall({
      id: 't-dup-2',
      name: 'launch',
      input: { name: 'dup', recipe: recipePath, dataDir: dataDir2 },
    });
    expect(second.success).toBe(false);
    expect(second.error).toMatch(/already/);

    // Cleanup: kill the running one.
    await fleet.handleToolCall({ id: 't-dup-kill', name: 'kill', input: { name: 'dup' } });
  }, 60_000);

  test('onChildEvent fans out wire events live (no buffer poll needed)', async () => {
    const dataDir3 = join(tmpDir, 'sub');
    const seen: Array<{ child: string; type: string }> = [];
    const unsub = fleet.onChildEvent('*', (childName, evt) => {
      seen.push({ child: childName, type: evt.type });
    });

    const spawnRes = await fleet.handleToolCall({
      id: 't-sub-spawn',
      name: 'launch',
      input: { name: 'sub', recipe: recipePath, dataDir: dataDir3 },
    });
    expect(spawnRes.success).toBe(true);

    // The lifecycle:ready event should have been fanned out by the time
    // launch returned (handleLaunch awaits waitForReady which polls status).
    expect(seen.some((e) => e.child === 'sub' && e.type === 'lifecycle')).toBe(true);

    await fleet.handleToolCall({ id: 't-sub-cmd', name: 'command', input: { name: 'sub', command: '/help' } });

    // Wait for command-output events to fan out.
    const start = Date.now();
    while (Date.now() - start < 5_000) {
      if (seen.filter((e) => e.type === 'command-output').length >= 5) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(seen.filter((e) => e.type === 'command-output').length).toBeGreaterThanOrEqual(5);

    unsub();
    await fleet.handleToolCall({ id: 't-sub-kill', name: 'kill', input: { name: 'sub' } });
  }, 60_000);

  test('handlers reject unknown child names', async () => {
    const send = await fleet.handleToolCall({ id: 't-u-send', name: 'send', input: { name: 'ghost', content: 'hi' } });
    expect(send.success).toBe(false);
    expect(send.error).toMatch(/Unknown child/);

    const peek = await fleet.handleToolCall({ id: 't-u-peek', name: 'peek', input: { name: 'ghost' } });
    expect(peek.success).toBe(false);

    const kill = await fleet.handleToolCall({ id: 't-u-kill', name: 'kill', input: { name: 'ghost' } });
    expect(kill.success).toBe(false);
  });
});

describe('FleetModule — Phase 4 autoStart + allowlist', () => {
  let tmpDir: string;
  let recipePath: string;
  // Each test below builds its own FleetModule and (in the happy path) calls
  // .stop() before returning.  But if a test throws or times out — or, like
  // adopt-on-restart, intentionally uses detachMode — children spawned with
  // detached:true survive and orphan to PID 1.  Push every fleet here so
  // afterAll can defensively reap whatever the test bodies missed.
  const activeFleets: FleetModule[] = [];

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'fkm-fleet-as-'));
    recipePath = join(tmpDir, 'recipe.json');
    writeFileSync(recipePath, JSON.stringify(MINIMAL_RECIPE), 'utf-8');
    process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'sk-test-fleet-smoke';
  });

  afterAll(async () => {
    // Reap in parallel; serial awaits would exceed Bun's hook budget on the
    // worst-case timeout path. undo any leftover detach-mode (adopt-on-restart
    // sets it) so stop() actually kills children, not just disconnects sockets.
    await Promise.all(activeFleets.map(async (f) => {
      try { f.setDetachMode(false); } catch { /* noop */ }
      try { await f.stop(); } catch { /* noop */ }
    }));
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* noop */ }
  }, 30_000);

  test('autoStart children launch during start() and reach ready', async () => {
    const fleet = new FleetModule({
      childIndexPath: INDEX_PATH,
      autoStart: [
        { name: 'a', recipe: recipePath, dataDir: join(tmpDir, 'a') },
        { name: 'b', recipe: recipePath, dataDir: join(tmpDir, 'b') },
      ],
      socketWaitTimeoutMs: 15_000,
      readyTimeoutMs: 10_000,
      gracefulShutdownMs: 5_000,
      sigtermEscalationMs: 2_000,
    });
    activeFleets.push(fleet);

    // Minimal ModuleContext stub — start() only uses ctx for .setState which we don't exercise here.
    await fleet.start({} as unknown as Parameters<typeof fleet.start>[0]);

    // autoStart is fire-and-forget, so wait for both to reach ready.
    const start = Date.now();
    while (Date.now() - start < 30_000) {
      const ready = [...fleet.getChildren().values()].filter((c) => c.status === 'ready').length;
      if (ready === 2) break;
      await new Promise((r) => setTimeout(r, 100));
    }

    const children = [...fleet.getChildren().values()];
    expect(children).toHaveLength(2);
    expect(children.every((c) => c.status === 'ready')).toBe(true);

    await fleet.stop();
  }, 60_000);

  test('allowlist rejects recipes outside the list (children recipes are implicitly allowed)', async () => {
    const fleet = new FleetModule({
      childIndexPath: INDEX_PATH,
      autoStart: [],
      allowedRecipes: [recipePath],  // only this one path
      socketWaitTimeoutMs: 15_000,
      readyTimeoutMs: 10_000,
      gracefulShutdownMs: 5_000,
      sigtermEscalationMs: 2_000,
    });
    activeFleets.push(fleet);
    await fleet.start({} as unknown as Parameters<typeof fleet.start>[0]);

    const bogus = join(tmpDir, 'bogus-recipe.json');
    const res = await fleet.handleToolCall({
      id: 't-allow-deny',
      name: 'launch',
      input: { name: 'nope', recipe: bogus, dataDir: join(tmpDir, 'nope') },
    });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/allowlist/i);

    // Listed path should be accepted.
    const ok = await fleet.handleToolCall({
      id: 't-allow-ok',
      name: 'launch',
      input: { name: 'ok', recipe: recipePath, dataDir: join(tmpDir, 'ok') },
    });
    expect(ok.success).toBe(true);

    await fleet.stop();
  }, 60_000);

  test('subscription filter narrows per-subscriber event stream', async () => {
    const fleet = new FleetModule({
      childIndexPath: INDEX_PATH,
      autoStart: [],
      socketWaitTimeoutMs: 15_000,
      readyTimeoutMs: 10_000,
      gracefulShutdownMs: 5_000,
      sigtermEscalationMs: 2_000,
    });
    activeFleets.push(fleet);
    await fleet.start({} as unknown as Parameters<typeof fleet.start>[0]);

    const allEvents: string[] = [];
    const filteredEvents: string[] = [];
    const unsubAll = fleet.onChildEvent('*', (_n, e) => { allEvents.push(e.type); });
    const unsubFiltered = fleet.onChildEvent('*', (_n, e) => { filteredEvents.push(e.type); }, ['lifecycle']);

    const dataDir = join(tmpDir, 'filter');
    const res = await fleet.handleToolCall({
      id: 't-filt-spawn',
      name: 'launch',
      input: { name: 'filt', recipe: recipePath, dataDir },
    });
    expect(res.success).toBe(true);

    await fleet.handleToolCall({ id: 't-filt-cmd', name: 'command', input: { name: 'filt', command: '/help' } });

    await new Promise((r) => setTimeout(r, 500));

    // Unfiltered should include both lifecycle and command-output.
    expect(allEvents.some((t) => t === 'lifecycle')).toBe(true);
    expect(allEvents.some((t) => t === 'command-output')).toBe(true);
    // Filtered should include ONLY lifecycle — no command-output leak-through.
    expect(filteredEvents.some((t) => t === 'lifecycle')).toBe(true);
    expect(filteredEvents.every((t) => t === 'lifecycle')).toBe(true);

    unsubAll();
    unsubFiltered();
    await fleet.handleToolCall({ id: 't-filt-kill', name: 'kill', input: { name: 'filt' } });
    await fleet.stop();
  }, 60_000);

  test('adopt-on-restart: second FleetModule with shared state reattaches to running child', async () => {
    // A minimal in-memory ctx that survives across FleetModule instances.
    const store: { fleet?: unknown } = {};
    const stubCtx = {
      setState: <T>(s: T): void => { store.fleet = s; },
      getState: <T>(): T | null => (store.fleet as T | null) ?? null,
      pushEvent: (): void => {},
      getModule: (): null => null,
    } as unknown as Parameters<FleetModule['start']>[0];

    // First parent: spawn, detach (child keeps running).
    const fleet1 = new FleetModule({
      childIndexPath: INDEX_PATH,
      socketWaitTimeoutMs: 15_000,
      readyTimeoutMs: 10_000,
      // Snappy shutdown so the afterAll safety net stays within hook budget
      // if anything between detach and the explicit kill below throws.
      gracefulShutdownMs: 1_000,
      sigtermEscalationMs: 500,
    });
    activeFleets.push(fleet1);
    await fleet1.start(stubCtx);
    const dataDir = join(tmpDir, 'adopt');
    const res1 = await fleet1.handleToolCall({
      id: 't-adopt-spawn',
      name: 'launch',
      input: { name: 'adoptee', recipe: recipePath, dataDir },
    });
    expect(res1.success).toBe(true);
    const pidBefore = (res1.data as { pid: number }).pid;

    fleet1.setDetachMode(true);
    await fleet1.stop();

    // Brief gap to simulate parent restart.
    await new Promise((r) => setTimeout(r, 200));

    // Second parent: same shared state; should adopt rather than respawn.
    const fleet2 = new FleetModule({
      childIndexPath: INDEX_PATH,
      socketWaitTimeoutMs: 15_000,
      readyTimeoutMs: 10_000,
      gracefulShutdownMs: 1_000,
      sigtermEscalationMs: 500,
    });
    activeFleets.push(fleet2);
    await fleet2.start(stubCtx);

    // The adopted child should be in the new fleet's map, ready, with the SAME pid.
    const adopted = fleet2.getChildren().get('adoptee');
    expect(adopted).toBeDefined();
    expect(adopted?.status).toBe('ready');
    expect(adopted?.pid).toBe(pidBefore);

    // Send a command to confirm the socket works end-to-end.
    const cmd = await fleet2.handleToolCall({
      id: 't-adopt-cmd',
      name: 'command',
      input: { name: 'adoptee', command: '/help' },
    });
    expect(cmd.success).toBe(true);

    await fleet2.handleToolCall({ id: 't-adopt-kill', name: 'kill', input: { name: 'adoptee' } });
    await fleet2.stop();
  }, 60_000);

  test('relative launch path matches implicit absolute-path allowlist via CWD resolve', async () => {
    // Simulates the conductor's post-fix situation: autoStart children carry
    // absolute paths (resolved at recipe-load time), so the implicit allowlist
    // is absolute; but the agent calls fleet--launch with a CWD-relative
    // string.  The launch check must try both forms.
    const fleet = new FleetModule({
      childIndexPath: INDEX_PATH,
      autoStart: [
        // Registers an absolute path in the implicit allowlist without
        // actually starting (autoStart: false).
        { name: 'placeholder', recipe: recipePath, autoStart: false },
      ],
      socketWaitTimeoutMs: 15_000,
      readyTimeoutMs: 10_000,
      gracefulShutdownMs: 5_000,
      sigtermEscalationMs: 2_000,
    });
    activeFleets.push(fleet);
    await fleet.start({} as unknown as Parameters<typeof fleet.start>[0]);

    // Run the launch from the recipe's directory so CWD-resolving "recipe.json"
    // lands on the absolute path registered above.
    const originalCwd = process.cwd();
    process.chdir(tmpDir);
    try {
      const res = await fleet.handleToolCall({
        id: 't-relative-allow',
        name: 'launch',
        input: { name: 'relauth', recipe: 'recipe.json', dataDir: join(tmpDir, 'relauth') },
      });
      expect(res.success).toBe(true);
      await fleet.handleToolCall({ id: 't-relative-kill', name: 'kill', input: { name: 'relauth' } });
    } finally {
      process.chdir(originalCwd);
    }

    await fleet.stop();
  }, 60_000);

  test('allowlist prefix wildcard works', async () => {
    const fleet = new FleetModule({
      childIndexPath: INDEX_PATH,
      autoStart: [],
      allowedRecipes: [`${tmpDir}/*`],
      socketWaitTimeoutMs: 15_000,
      readyTimeoutMs: 10_000,
      gracefulShutdownMs: 5_000,
      sigtermEscalationMs: 2_000,
    });
    activeFleets.push(fleet);
    await fleet.start({} as unknown as Parameters<typeof fleet.start>[0]);

    // Any recipe under tmpDir/ should match.
    const ok = await fleet.handleToolCall({
      id: 't-glob-ok',
      name: 'launch',
      input: { name: 'glob', recipe: recipePath, dataDir: join(tmpDir, 'glob') },
    });
    expect(ok.success).toBe(true);

    // Something outside tmpDir should not.
    const bad = await fleet.handleToolCall({
      id: 't-glob-bad',
      name: 'launch',
      input: { name: 'bad', recipe: '/somewhere/else.json', dataDir: join(tmpDir, 'bad') },
    });
    expect(bad.success).toBe(false);

    await fleet.stop();
  }, 60_000);
});
