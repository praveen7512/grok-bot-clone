import Docker from 'dockerode';
import { PassThrough, Duplex } from 'node:stream';
import type { Logger } from '../lib/logger.js';
import { SandboxUnavailableError } from '../lib/errors.js';
import { capOutput, type ExecResult, type SandboxProvider, type SandboxStatus, type ScreenMode } from './types.js';

export interface DockerProviderOptions {
  image: string;
  memoryMb: number;
  cpus: number;
  pidsLimit: number;
  network: 'none' | 'isolated' | 'egress';
  instance: string;
  socketPath?: string;
}

const LABEL_MANAGED = 'botclone.managed';
const LABEL_BOT = 'botclone.bot';
const LABEL_INSTANCE = 'botclone.instance';

export const containerName = (botId: string) => `botclone-bot-${botId}`;
export const volumeName = (botId: string) => `botclone-vol-${botId}`;

const isNotFound = (e: unknown) => (e as { statusCode?: number })?.statusCode === 404;

export class DockerProvider implements SandboxProvider {
  readonly kind = 'docker' as const;
  readonly supportsScreen = true;
  readonly docker: Docker;

  constructor(private opts: DockerProviderOptions, private log: Logger, docker?: Docker) {
    this.docker = docker ?? new Docker(opts.socketPath ? { socketPath: opts.socketPath } : undefined);
  }

  async available(): Promise<boolean> {
    try {
      await this.docker.ping();
      return true;
    } catch {
      return false;
    }
  }

  private async requireDocker() {
    if (!(await this.available())) {
      throw new SandboxUnavailableError(
        'Docker is not reachable. Start Docker Desktop (or the Docker daemon) and try again, or set SANDBOX_MODE=subprocess for demo mode.',
      );
    }
  }

  private async ensureImage() {
    try {
      await this.docker.getImage(this.opts.image).inspect();
      return;
    } catch (e) {
      if (!isNotFound(e)) throw e;
    }
    this.log.info({ image: this.opts.image }, 'sandbox image missing locally, trying to pull');
    try {
      const stream = await this.docker.pull(this.opts.image);
      await new Promise<void>((resolve, reject) =>
        this.docker.modem.followProgress(stream, (err) => (err ? reject(err) : resolve())),
      );
    } catch {
      throw new SandboxUnavailableError(
        `Sandbox image "${this.opts.image}" not found. Build it with "npm run sandbox:build" (or "docker compose build").`,
      );
    }
  }

  private async networkMode(): Promise<string> {
    if (this.opts.network === 'none') return 'none';
    const name = this.opts.network === 'isolated' ? 'botclone-isolated' : 'botclone-egress';
    try {
      await this.docker.getNetwork(name).inspect();
    } catch (e) {
      if (!isNotFound(e)) throw e;
      await this.docker.createNetwork({
        Name: name,
        Driver: 'bridge',
        Internal: this.opts.network === 'isolated',
        Labels: { [LABEL_MANAGED]: 'true' },
        // no inter-container traffic: bots cannot talk to each other
        Options: { 'com.docker.network.bridge.enable_icc': 'false' },
      });
    }
    return name;
  }

  /** Exposed for tests: the exact container spec we create. */
  buildCreateOptions(botId: string, networkMode: string): Docker.ContainerCreateOptions {
    return {
      name: containerName(botId),
      Image: this.opts.image,
      Hostname: `bot-${botId.slice(0, 8)}`,
      Labels: { [LABEL_MANAGED]: 'true', [LABEL_BOT]: botId, [LABEL_INSTANCE]: this.opts.instance },
      Env: ['DISPLAY=:1', 'HOME=/home/bot'],
      WorkingDir: '/home/bot',
      ExposedPorts: {}, // nothing exposed: VNC is tunnelled over docker exec
      HostConfig: {
        Memory: this.opts.memoryMb * 1024 * 1024,
        MemorySwap: this.opts.memoryMb * 1024 * 1024,
        NanoCpus: Math.round(this.opts.cpus * 1e9),
        PidsLimit: this.opts.pidsLimit,
        CapDrop: ['ALL'],
        SecurityOpt: ['no-new-privileges:true'],
        ShmSize: 128 * 1024 * 1024,
        Init: true,
        NetworkMode: networkMode,
        Binds: [], // never mount host paths
        Mounts: [{ Type: 'volume', Source: volumeName(botId), Target: '/home/bot' }],
        PortBindings: {},
        PublishAllPorts: false,
        Privileged: false,
        RestartPolicy: { Name: 'no' },
      },
    };
  }

  async provision(botId: string): Promise<{ ref: string }> {
    await this.requireDocker();
    await this.ensureImage();
    const netMode = await this.networkMode();
    await this.docker.createVolume({ Name: volumeName(botId), Labels: { [LABEL_MANAGED]: 'true', [LABEL_BOT]: botId, [LABEL_INSTANCE]: this.opts.instance } });
    const container = await this.docker.createContainer(this.buildCreateOptions(botId, netMode));
    await container.start();
    this.log.info({ botId, container: container.id.slice(0, 12) }, 'sandbox provisioned');
    return { ref: container.id };
  }

  async ensureRunning(botId: string): Promise<void> {
    await this.requireDocker();
    const c = this.docker.getContainer(containerName(botId));
    let info: Docker.ContainerInspectInfo;
    try {
      info = await c.inspect();
    } catch (e) {
      if (!isNotFound(e)) throw e;
      this.log.warn({ botId }, 'sandbox missing, re-provisioning');
      await this.provision(botId);
      return;
    }
    if (!info.State.Running) {
      if (info.State.Paused) await c.unpause();
      else await c.start();
      this.log.info({ botId }, 'sandbox restarted');
    }
  }

  async exec(botId: string, command: string, { timeoutMs }: { timeoutMs: number }): Promise<ExecResult> {
    await this.ensureRunning(botId);
    const c = this.docker.getContainer(containerName(botId));
    const secs = Math.max(1, Math.ceil(timeoutMs / 1000));
    const exec = await c.exec({
      Cmd: ['timeout', '-k', '2', String(secs), 'bash', '-lc', command],
      AttachStdout: true,
      AttachStderr: true,
      WorkingDir: '/home/bot',
      User: 'bot',
      Env: ['DISPLAY=:1'],
    });
    const stream = await exec.start({ hijack: true, stdin: false });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    const so = new PassThrough();
    const se = new PassThrough();
    so.on('data', (d: Buffer) => out.push(d));
    se.on('data', (d: Buffer) => err.push(d));
    this.docker.modem.demuxStream(stream, so, se);

    let guardTimedOut = false;
    await new Promise<void>((resolve) => {
      const guard = setTimeout(() => {
        guardTimedOut = true;
        stream.destroy();
        resolve();
      }, timeoutMs + 5000);
      stream.on('end', () => { clearTimeout(guard); resolve(); });
      stream.on('close', () => { clearTimeout(guard); resolve(); });
      stream.on('error', () => { clearTimeout(guard); resolve(); });
    });
    const inspect = await exec.inspect().catch(() => undefined);
    const exitCode = inspect?.ExitCode ?? null;
    const o = capOutput(Buffer.concat(out).toString('utf8'));
    const e = capOutput(Buffer.concat(err).toString('utf8'));
    return {
      stdout: o.text,
      stderr: e.text,
      exitCode,
      timedOut: guardTimedOut || exitCode === 124 || exitCode === 137,
      truncated: o.truncated || e.truncated,
    };
  }

  async stop(botId: string) {
    try {
      await this.docker.getContainer(containerName(botId)).stop({ t: 5 });
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code !== 304 && code !== 404) throw e;
    }
  }

  async teardown(botId: string) {
    try {
      await this.docker.getContainer(containerName(botId)).remove({ force: true, v: false });
    } catch (e) {
      if (!isNotFound(e)) throw e;
    }
    try {
      await this.docker.getVolume(volumeName(botId)).remove();
    } catch (e) {
      if (!isNotFound(e)) throw e;
    }
    this.log.info({ botId }, 'sandbox torn down');
  }

  async status(botId: string): Promise<SandboxStatus> {
    if (!(await this.available())) return { kind: 'docker', state: 'unavailable', detail: 'Docker is not reachable' };
    try {
      const info = await this.docker.getContainer(containerName(botId)).inspect();
      return {
        kind: 'docker',
        state: info.State.Running ? 'running' : 'stopped',
        health: info.State.Health?.Status,
      };
    } catch (e) {
      if (isNotFound(e)) return { kind: 'docker', state: 'missing' };
      throw e;
    }
  }

  async listManaged(): Promise<string[]> {
    const list = await this.docker.listContainers({
      all: true,
      filters: { label: [`${LABEL_MANAGED}=true`, `${LABEL_INSTANCE}=${this.opts.instance}`] },
    });
    return list.map((c) => c.Labels[LABEL_BOT]).filter((x): x is string => !!x);
  }

  async openVncStream(botId: string, mode: ScreenMode): Promise<Duplex> {
    await this.ensureRunning(botId);
    const port = mode === 'control' ? 5900 : 5901;
    const exec = await this.docker.getContainer(containerName(botId)).exec({
      Cmd: ['socat', '-', `TCP:127.0.0.1:${port}`],
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
      User: 'bot',
    });
    const raw = await exec.start({ hijack: true, stdin: true });
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    stderr.on('data', (d: Buffer) => this.log.debug({ botId, msg: d.toString() }, 'vnc tunnel stderr'));
    this.docker.modem.demuxStream(raw, stdout, stderr);
    raw.on('end', () => stdout.end());
    raw.on('close', () => stdout.end());
    // Duplex: reads come from demuxed stdout, writes go straight to exec stdin
    const duplex = new Duplex({
      read() {},
      write(chunk, _enc, cb) {
        raw.write(chunk, cb);
      },
      final(cb) {
        raw.end();
        cb();
      },
      destroy(err, cb) {
        raw.destroy();
        cb(err);
      },
    });
    stdout.on('data', (d: Buffer) => duplex.push(d));
    stdout.on('end', () => duplex.push(null));
    return duplex;
  }
}
