import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DockerProvider, containerName, volumeName } from '../src/orchestrator/dockerProvider.js';
import { FakeDocker, makeStack, silentLog } from './helpers.js';

const opts = { image: 'botclone-sandbox:latest', memoryMb: 512, cpus: 1, pidsLimit: 256, network: 'egress' as const, instance: 'botclone' };
const makeDocker = (fake: FakeDocker, o = opts) => new DockerProvider(o, silentLog, fake as any);

test('container spec: limits, no host mounts, no ports, hardened', () => {
  const p = makeDocker(new FakeDocker());
  const spec = p.buildCreateOptions('abc', 'botclone-egress');
  const h = spec.HostConfig!;
  assert.equal(h.Memory, 512 * 1024 * 1024);
  assert.equal(h.MemorySwap, h.Memory);
  assert.equal(h.NanoCpus, 1e9);
  assert.equal(h.PidsLimit, 256);
  assert.deepEqual(h.CapDrop, ['ALL']);
  assert.ok(h.SecurityOpt!.includes('no-new-privileges:true'));
  assert.equal(h.Privileged, false);
  assert.deepEqual(h.Binds, []);
  assert.deepEqual(h.PortBindings, {});
  assert.equal(h.Mounts!.length, 1);
  assert.equal(h.Mounts![0]!.Type, 'volume', 'only a docker-managed volume, never a bind mount');
  assert.equal(spec.Labels!['botclone.bot'], 'abc');
});

test('network policy: isolated creates an internal network, none uses no network', async () => {
  const fake = new FakeDocker();
  await makeDocker(fake, { ...opts, network: 'isolated' }).provision('b1');
  assert.ok(fake.calls.includes('createNetwork:botclone-isolated:internal=true'));
  const fake2 = new FakeDocker();
  await makeDocker(fake2, { ...opts, network: 'none' }).provision('b2');
  assert.equal(fake2.containers.get(containerName('b2'))!.opts.HostConfig.NetworkMode, 'none');
});

test('bot create provisions a container; delete tears down container + volume', async () => {
  const fake = new FakeDocker();
  const s = await makeStack({ docker: makeDocker(fake), mode: 'docker' });
  const bot = await s.bots.create({ name: 'Dock' });
  assert.equal(bot.status, 'ready');
  assert.equal(bot.sandboxKind, 'docker');
  assert.ok(fake.containers.get(containerName(bot.id))!.running);
  await s.bots.delete(bot.id);
  assert.ok(fake.calls.includes(`removeContainer:${containerName(bot.id)}`));
  assert.ok(fake.calls.includes(`removeVolume:${volumeName(bot.id)}`));
  assert.equal(s.bots.list().length, 0);
});

test('provisioning failure rolls back atomically', async () => {
  const fake = new FakeDocker();
  fake.failCreate = true;
  const s = await makeStack({ docker: makeDocker(fake), mode: 'docker' });
  await assert.rejects(s.bots.create({ name: 'Broken' }), /simulated create failure/);
  assert.equal(s.bots.list().length, 0, 'no half-created bot row');
  assert.equal(fake.volumes.size, 0, 'partial volume removed');
});

test('docker down: clear error and no bot left behind', async () => {
  const fake = new FakeDocker();
  fake.up = false;
  const s = await makeStack({ docker: makeDocker(fake), mode: 'docker' });
  await assert.rejects(s.bots.create({ name: 'X' }), /Docker is not reachable/);
  assert.equal(s.bots.list().length, 0);
});

test('auto mode falls back to demo subprocess sandboxes when docker is down', async () => {
  const fake = new FakeDocker();
  fake.up = false;
  const s = await makeStack({ docker: makeDocker(fake), mode: 'auto' });
  const bot = await s.bots.create({ name: 'Demo' });
  assert.equal(bot.sandboxKind, 'subprocess');
});

test('missing image gives an actionable error', async () => {
  const fake = new FakeDocker();
  fake.images.clear();
  await assert.rejects(makeDocker(fake).provision('z'), /npm run sandbox:build/);
});

test('startup reconcile removes orphans and marks lost sandboxes', async () => {
  const fake = new FakeDocker();
  const docker = makeDocker(fake);
  const s = await makeStack({ docker, mode: 'docker' });
  const keep = await s.bots.create({ name: 'Keep' });
  const lost = await s.bots.create({ name: 'Lost' });
  await docker.provision('orphan-bot');
  fake.containers.delete(containerName(lost.id));
  await s.bots.recoverOnStartup();
  assert.ok(!fake.containers.has(containerName('orphan-bot')), 'orphan removed');
  assert.ok(fake.containers.has(containerName(keep.id)));
  assert.equal(s.bots.get(lost.id).status, 'stopped');
});

test('lazy restart: stopped/missing container is restarted on exec path', async () => {
  const fake = new FakeDocker();
  const docker = makeDocker(fake);
  await docker.provision('lazy');
  fake.containers.get(containerName('lazy'))!.running = false;
  await docker.ensureRunning('lazy');
  assert.ok(fake.containers.get(containerName('lazy'))!.running);
  fake.containers.delete(containerName('lazy'));
  await docker.ensureRunning('lazy');
  assert.ok(fake.containers.get(containerName('lazy'))!.running, 're-provisioned');
});

test('idle reaper stops idle containers', async () => {
  const fake = new FakeDocker();
  const s = await makeStack({ docker: makeDocker(fake), mode: 'docker' });
  const bot = await s.bots.create({ name: 'Idle' });
  const stopped = await s.orchestrator.reapOnce(Date.now() + 31 * 60_000);
  assert.deepEqual(stopped, [bot.id]);
  assert.equal(fake.containers.get(containerName(bot.id))!.running, false);
});

test('screen is refused in demo mode', async () => {
  const s = await makeStack();
  const bot = await s.bots.create({ name: 'Demo' });
  await assert.rejects(s.orchestrator.openVnc(bot.id, bot.sandboxKind, 'view'), /Docker sandboxes/);
});
