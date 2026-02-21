import Docker from 'dockerode'
import { DeploymentProvider, DeploymentResult } from './provider'
import { prisma } from '@/lib/prisma'
import { allocatePort } from '@/lib/utils/port-allocator'
import {
  generateOpenClawConfig,
  buildEnvironmentVariables,
  UserConfiguration,
} from '@/lib/openclaw/config-builder'
import { InstanceStatus } from '@prisma/client'
import { randomUUID } from 'crypto'
import * as fs from 'fs'
import * as path from 'path'

const OPENCLAW_IMAGE = process.env.OPENCLAW_IMAGE || 'ghcr.io/placeparks/bot-saas/openclaw-wrapper:latest'
const DOCKER_NETWORK = process.env.DOCKER_NETWORK || 'openclaw-network'
const DATA_DIR = process.env.OPENCLAW_DATA_DIR || '/data/openclaw'

// Pairing server JS — same script used by Railway, but loaded from file on Docker
const PAIRING_SERVER_JS = `
const http = require('http');
const net = require('net');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

function send(res, code, data) {
  const payload = JSON.stringify(data);
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(payload);
}

function extractQr(raw) {
  if (!raw) return null;
  const jsonMatch = raw.match(/"qr"\\s*:\\s*"([^"]+)"/i);
  if (jsonMatch && jsonMatch[1]) return jsonMatch[1];
  const lineMatch = raw.match(/\\bqr\\s*[:=]\\s*([A-Za-z0-9+/=_:-]+)/i);
  if (lineMatch && lineMatch[1]) return lineMatch[1];
  return null;
}

function hasAsciiQr(raw) {
  return typeof raw === 'string' && raw.includes('\\u2584\\u2584') && raw.includes('\\u2588');
}

function readBody(req, cb) {
  let buf = '';
  req.on('data', (c) => { buf += c; });
  req.on('end', () => {
    try { cb(null, buf ? JSON.parse(buf) : {}); }
    catch (e) { cb(e); }
  });
}

const handler = (req, res) => {
  console.log('[pairing-server]', req.method, req.url);

  if (req.method === 'GET' && req.url === '/health') {
    return send(res, 200, { status: 'ok' });
  }

  if (req.method === 'GET' && req.url && req.url.startsWith('/pairing/list/')) {
    const ch = req.url.split('/').pop();
    const r = spawnSync('openclaw', ['pairing', 'list', ch], { encoding: 'utf8', timeout: 10000 });
    return send(res, 200, { success: r.status === 0, raw: r.stdout || '', requests: [] });
  }

  if (req.method === 'POST' && req.url === '/pairing/approve') {
    return readBody(req, (err, body) => {
      if (err) return send(res, 400, { success: false, message: 'Invalid JSON' });
      const ch = body.channel || '';
      const code = body.code || '';
      if (!ch || !code) return send(res, 400, { success: false, message: 'Missing channel or code' });
      const r = spawnSync('openclaw', ['pairing', 'approve', ch, code], { encoding: 'utf8', timeout: 15000 });
      const ok = r.status === 0;
      return send(res, ok ? 200 : 500, {
        success: ok,
        output: r.stdout || '',
        message: ok ? 'Pairing approved successfully' : (r.stderr || 'Pairing failed')
      });
    });
  }

  if (req.method === 'POST' && req.url === '/whatsapp/qr') {
    const r = spawnSync('openclaw', ['channels', 'login'], { encoding: 'utf8', timeout: 20000 });
    const raw = [r.stdout || '', r.stderr || ''].join('\\n').trim();
    const qr = extractQr(raw);
    const ok = Boolean(qr) || hasAsciiQr(raw) || r.status === 0;
    return send(res, ok ? 200 : 500, { success: ok, qr, raw });
  }

  if (req.method === 'POST' && req.url === '/config/reload') {
    return readBody(req, (err, body) => {
      if (err) return send(res, 400, { success: false, message: 'Invalid JSON' });
      try {
        const configPath = process.env.OPENCLAW_CONFIG_PATH || '/tmp/.openclaw/openclaw.json';
        require('fs').writeFileSync(configPath, JSON.stringify(body.config, null, 2));
        send(res, 200, { success: true, message: 'Config written. Restart required.' });
      } catch (e) {
        send(res, 500, { success: false, message: e.message });
      }
    });
  }

  if (req.method === 'GET' && req.url && req.url.startsWith('/canvas')) {
    var gatewayPath = req.url.slice('/canvas'.length) || '/';
    var token = process.env.OPENCLAW_GATEWAY_TOKEN || '';
    var gatewayReq = http.request({
      hostname: 'localhost', port: 18789,
      path: gatewayPath || '/', method: 'GET',
      headers: token ? { 'Authorization': 'Bearer ' + token } : {}
    }, function(gatewayRes) {
      var ct = gatewayRes.headers['content-type'] || 'text/html';
      res.writeHead(gatewayRes.statusCode, { 'Content-Type': ct });
      gatewayRes.pipe(res);
    });
    gatewayReq.on('error', function(e) {
      res.writeHead(503); res.end(JSON.stringify({ error: 'Canvas unreachable', detail: e.message }));
    });
    gatewayReq.end();
    return;
  }

  res.writeHead(404);
  res.end();
};

const server = http.createServer(handler);

// Encode a WebSocket text frame (client→server direction, must be masked per RFC 6455)
function encWsFrame(text) {
  var pl = Buffer.from(text, 'utf8');
  var len = pl.length;
  var mk = crypto.randomBytes(4);
  var hlen = len < 126 ? 2 : 4;
  var fr = Buffer.alloc(hlen + 4 + len);
  fr[0] = 0x81; // FIN + text opcode
  if (len < 126) { fr[1] = 0x80 | len; }
  else { fr[1] = 0x80 | 126; fr.writeUInt16BE(len, 2); }
  mk.copy(fr, hlen);
  for (var i = 0; i < len; i++) fr[hlen + 4 + i] = pl[i] ^ mk[i % 4];
  return fr;
}

// Decode a WebSocket frame (server→client direction, unmasked)
function decWsFrame(buf) {
  if (buf.length < 2) return null;
  var len = buf[1] & 0x7f;
  var hlen = 2;
  if (len === 126) { if (buf.length < 4) return null; len = buf.readUInt16BE(2); hlen = 4; }
  else if (len === 127) { if (buf.length < 10) return null; len = buf.readUInt32BE(6); hlen = 10; }
  if (buf.length < hlen + len) return null;
  return { op: buf[0] & 0x0f, pl: buf.slice(hlen, hlen + len), total: hlen + len };
}

// WebSocket canvas bridge: authenticates as an OpenClaw node then proxies to browser.
server.on('upgrade', function(req, socket, head) {
  var url = req.url || '';
  if (!url.startsWith('/canvas-ws')) {
    socket.write('HTTP/1.1 404 Not Found\\r\\n\\r\\n');
    socket.destroy();
    return;
  }
  var gwToken = process.env.OPENCLAW_GATEWAY_TOKEN || '';

  // Complete WS handshake with the browser first
  var bKey = req.headers['sec-websocket-key'] || '';
  var bAccept = crypto.createHash('sha1')
    .update(bKey + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\\r\\n' +
    'Upgrade: websocket\\r\\n' +
    'Connection: Upgrade\\r\\n' +
    'Sec-WebSocket-Accept: ' + bAccept + '\\r\\n\\r\\n'
  );

  var gw = net.createConnection(18789, '127.0.0.1');
  var gwBuf = Buffer.alloc(0);
  var gwHttpOk = false;
  var authOk = false;
  var brQueue = (head && head.length) ? [head] : [];

  socket.on('error', function() { try { gw.destroy(); } catch(e) {} });
  socket.on('close', function() { try { gw.destroy(); } catch(e) {} });
  gw.on('error', function(e) {
    console.error('[canvas-ws] gw err:', e.message);
    try { socket.destroy(); } catch(x) {}
  });
  gw.on('close', function() { try { socket.destroy(); } catch(x) {} });

  socket.on('data', function(d) { if (!authOk) brQueue.push(d); });

  gw.on('connect', function() {
    var gwKey = crypto.randomBytes(16).toString('base64');
    gw.write(
      'GET /__openclaw__/ws HTTP/1.1\\r\\n' +
      'Host: localhost:18789\\r\\n' +
      'Upgrade: websocket\\r\\n' +
      'Connection: Upgrade\\r\\n' +
      'Sec-WebSocket-Key: ' + gwKey + '\\r\\n' +
      'Sec-WebSocket-Version: 13\\r\\n\\r\\n'
    );
  });

  gw.on('data', function(chunk) {
    gwBuf = Buffer.concat([gwBuf, chunk]);
    if (!gwHttpOk) {
      var sep = gwBuf.indexOf('\\r\\n\\r\\n');
      if (sep < 0) return;
      gwHttpOk = true;
      gwBuf = gwBuf.slice(sep + 4);
    }
    if (!authOk) {
      var fr = decWsFrame(gwBuf);
      if (!fr) return;
      if (fr.op === 1) {
        try {
          var msg = JSON.parse(fr.pl.toString('utf8'));
          if (msg.event === 'connect.challenge') {
            var nonce = (msg.payload || {}).nonce || '';
            gw.write(encWsFrame(JSON.stringify({
              type: 'event',
              event: 'connect.auth',
              payload: { token: gwToken, nonce: nonce }
            })));
            authOk = true;
            var rest = gwBuf.slice(fr.total);
            gwBuf = null;
            gw.removeAllListeners('data');
            socket.removeAllListeners('data');
            socket.removeAllListeners('error');
            socket.removeAllListeners('close');
            gw.removeAllListeners('error');
            gw.removeAllListeners('close');
            socket.on('error', function() { try { gw.destroy(); } catch(e) {} });
            socket.on('close', function() { try { gw.destroy(); } catch(e) {} });
            gw.on('error', function() { try { socket.destroy(); } catch(e) {} });
            gw.on('close', function() { try { socket.destroy(); } catch(e) {} });
            brQueue.forEach(function(d) { gw.write(d); });
            brQueue = null;
            if (rest.length) socket.write(rest);
            gw.on('data', function(d) { try { socket.write(d); } catch(e) {} });
            socket.on('data', function(d) { try { gw.write(d); } catch(e) {} });
          }
        } catch(e) {}
      }
    }
  });
});

const PORT = parseInt(process.env.PORT || '18800', 10);
server.listen(PORT, '0.0.0.0', () => {
  console.log('[pairing-server] listening on port', PORT);
});
if (PORT !== 18800) {
  const internal = http.createServer(handler);
  internal.listen(18800, '0.0.0.0', () => {
    console.log('[pairing-server] listening on port 18800');
  });
}
`.trim()

export class DockerProvider implements DeploymentProvider {
  private docker: Docker

  constructor() {
    const socketPath = process.env.DOCKER_SOCKET || '/var/run/docker.sock'
    const dockerHost = process.env.DOCKER_HOST_URL

    if (dockerHost) {
      // Remote Docker API (for when SaaS app runs on different machine)
      const url = new URL(dockerHost)
      this.docker = new Docker({
        host: url.hostname,
        port: parseInt(url.port || '2376'),
        protocol: url.protocol === 'https:' ? 'https' : 'http',
      })
    } else {
      // Local Docker socket
      this.docker = new Docker({ socketPath })
    }
  }

  /** Ensure the Docker network exists. */
  private async ensureNetwork(): Promise<void> {
    try {
      const network = this.docker.getNetwork(DOCKER_NETWORK)
      await network.inspect()
    } catch {
      await this.docker.createNetwork({ Name: DOCKER_NETWORK, Driver: 'bridge' })
      console.log(`[Docker] Created network: ${DOCKER_NETWORK}`)
    }
  }

  /** Ensure host directories exist for an instance. */
  private ensureDirectories(instanceId: string): { configDir: string; dataDir: string } {
    const configDir = path.join(DATA_DIR, 'instances', instanceId, 'config')
    const dataDir = path.join(DATA_DIR, 'instances', instanceId, 'data')
    fs.mkdirSync(configDir, { recursive: true })
    fs.mkdirSync(dataDir, { recursive: true })
    return { configDir, dataDir }
  }

  /** Write OpenClaw config JSON to host filesystem. */
  private writeConfigFile(instanceId: string, config: object): string {
    const configDir = path.join(DATA_DIR, 'instances', instanceId, 'config')
    fs.mkdirSync(configDir, { recursive: true })
    const configPath = path.join(configDir, 'openclaw.json')
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2))
    return configPath
  }

  /** Write pairing server script to shared location. */
  private ensurePairingServer(): string {
    const sharedDir = path.join(DATA_DIR, 'shared')
    fs.mkdirSync(sharedDir, { recursive: true })
    const scriptPath = path.join(sharedDir, 'pairing-server.js')
    fs.writeFileSync(scriptPath, PAIRING_SERVER_JS)
    return scriptPath
  }

  async deploy(userId: string, config: UserConfiguration): Promise<DeploymentResult> {
    // Use a unique ID per deployment so multiple agents per user don't conflict
    const shortId = randomUUID().slice(0, 8)
    const containerName = `openclaw-${shortId}`

    // Clean up any orphaned container with this specific name (failure recovery only)
    try {
      const orphan = this.docker.getContainer(containerName)
      await orphan.stop({ t: 5 }).catch(() => {})
      await orphan.remove({ force: true }).catch(() => {})
    } catch { /* no orphan */ }

    // Create placeholder DB record
    const port = await allocatePort()
    const instance = await prisma.instance.create({
      data: {
        userId,
        containerId: null,
        containerName,
        port,
        status: InstanceStatus.DEPLOYING,
      },
    })

    await this.logDeployment(instance.id, 'DEPLOY', 'IN_PROGRESS', 'Creating Docker container...')

    try {
      await this.ensureNetwork()
      const { configDir, dataDir } = this.ensureDirectories(instance.id)
      const pairingScriptPath = this.ensurePairingServer()

      // Build config
      const gatewayToken = config.gatewayToken || randomUUID()
      const openclawConfig = generateOpenClawConfig({ ...config, gatewayToken })
      this.writeConfigFile(instance.id, openclawConfig)

      // Build env vars
      const envVars = buildEnvironmentVariables(config)
      envVars.PORT = '18800'
      envVars.OPENCLAW_GATEWAY_TOKEN = gatewayToken
      envVars.OPENCLAW_CONFIG_PATH = '/tmp/.openclaw/openclaw.json'

      const envArray = Object.entries(envVars).map(([k, v]) => `${k}=${v}`)

      // Start command: run pairing server + openclaw
      const startCmd = [
        '/bin/sh', '-c',
        'node /tmp/pairing-server.js & sleep 1 && exec openclaw --config /tmp/.openclaw/openclaw.json'
      ]

      // Create container
      const container = await this.docker.createContainer({
        Image: OPENCLAW_IMAGE,
        name: containerName,
        Env: envArray,
        Cmd: startCmd,
        ExposedPorts: {
          '18789/tcp': {},
          '18800/tcp': {},
        },
        HostConfig: {
          Binds: [
            `${path.join(configDir, 'openclaw.json')}:/tmp/.openclaw/openclaw.json:ro`,
            `${dataDir}:/home/node/.openclaw/data`,
            `${pairingScriptPath}:/tmp/pairing-server.js:ro`,
          ],
          NetworkMode: DOCKER_NETWORK,
          RestartPolicy: { Name: 'unless-stopped' },
          // Resource limits per container
          Memory: 512 * 1024 * 1024, // 512MB
          NanoCpus: 500000000,        // 0.5 CPU
        },
      })

      await container.start()

      const containerId = container.id
      const serviceUrl = `http://${containerName}:18789`

      await prisma.instance.update({
        where: { id: instance.id },
        data: {
          containerId,
          containerName,
          status: InstanceStatus.DEPLOYING,
          serviceUrl,
          accessUrl: null, // Docker containers don't auto-get public URLs
        },
      })

      await this.logDeployment(instance.id, 'DEPLOY', 'SUCCESS', 'Docker container started')

      return {
        instanceId: instance.id,
        containerId,
        containerName,
        port,
        accessUrl: '',
        status: 'DEPLOYING',
        gatewayToken,
      }
    } catch (error: any) {
      await prisma.instance.update({
        where: { id: instance.id },
        data: { status: InstanceStatus.ERROR },
      })
      await this.logDeployment(instance.id, 'DEPLOY', 'FAILED', 'Deployment failed', error.message)
      throw new Error(`Docker deployment failed: ${error.message}`)
    }
  }

  async start(instanceId: string): Promise<void> {
    const instance = await this.requireInstance(instanceId)
    const container = this.docker.getContainer(instance.containerName)
    await container.start()
    await prisma.instance.update({ where: { id: instanceId }, data: { status: InstanceStatus.RUNNING } })
    await this.logDeployment(instanceId, 'START', 'SUCCESS', 'Instance started')
  }

  async stop(instanceId: string): Promise<void> {
    const instance = await this.requireInstance(instanceId)
    const container = this.docker.getContainer(instance.containerName)
    await container.stop({ t: 5 })
    await prisma.instance.update({ where: { id: instanceId }, data: { status: InstanceStatus.STOPPED } })
    await this.logDeployment(instanceId, 'STOP', 'SUCCESS', 'Instance stopped')
  }

  async restart(instanceId: string): Promise<void> {
    const instance = await this.requireInstance(instanceId)
    await prisma.instance.update({ where: { id: instanceId }, data: { status: InstanceStatus.RESTARTING } })
    const container = this.docker.getContainer(instance.containerName)
    await container.restart({ t: 5 })
    await prisma.instance.update({ where: { id: instanceId }, data: { status: InstanceStatus.RUNNING } })
    await this.logDeployment(instanceId, 'RESTART', 'SUCCESS', 'Instance restarted')
  }

  async destroy(instanceId: string): Promise<void> {
    const instance = await this.requireInstance(instanceId)
    const container = this.docker.getContainer(instance.containerName)
    await container.stop({ t: 5 }).catch(() => {})
    await container.remove({ force: true })

    // Clean up host files for this instance
    const instanceDir = path.join(DATA_DIR, 'instances', instanceId)
    fs.rmSync(instanceDir, { recursive: true, force: true })

    await prisma.instance.delete({ where: { id: instanceId } })
    await this.logDeployment(instanceId, 'DESTROY', 'SUCCESS', 'Instance destroyed')
  }

  async checkHealth(instanceId: string): Promise<boolean> {
    try {
      const instance = await this.requireInstance(instanceId)
      const container = this.docker.getContainer(instance.containerName)
      const info = await container.inspect()
      const isHealthy = info.State.Running === true

      await prisma.instance.update({
        where: { id: instanceId },
        data: {
          lastHealthCheck: new Date(),
          status: isHealthy ? InstanceStatus.RUNNING : InstanceStatus.ERROR,
        },
      })
      return isHealthy
    } catch {
      return false
    }
  }

  async getLogs(instanceId: string, tail = 100): Promise<string> {
    const instance = await this.requireInstance(instanceId)
    const container = this.docker.getContainer(instance.containerName)
    const logs = await container.logs({
      stdout: true,
      stderr: true,
      tail,
      timestamps: true,
    })
    return logs.toString('utf-8')
  }

  async updateConfig(instanceId: string, config: UserConfiguration): Promise<void> {
    const instance = await this.requireInstance(instanceId)

    // Regenerate config and write to host filesystem
    const gatewayToken = config.gatewayToken || randomUUID()
    const openclawConfig = generateOpenClawConfig({ ...config, gatewayToken })
    this.writeConfigFile(instanceId, openclawConfig)

    // Persist the gateway token so the canvas proxy can read it
    await prisma.configuration.update({
      where: { instanceId },
      data: { gatewayToken },
    })

    // Restart container to pick up new config (config is mounted as volume)
    const container = this.docker.getContainer(instance.containerName)
    await container.restart({ t: 5 })

    await prisma.instance.update({
      where: { id: instanceId },
      data: { status: InstanceStatus.RUNNING },
    })

    await this.logDeployment(instanceId, 'CONFIG_UPDATE', 'SUCCESS', 'Config updated and container restarted')
  }

  async getServiceUrl(instanceId: string): Promise<string | null> {
    const instance = await prisma.instance.findUnique({ where: { id: instanceId } })
    return instance?.serviceUrl ?? null
  }

  async getAccessUrl(instanceId: string): Promise<string | null> {
    const instance = await prisma.instance.findUnique({ where: { id: instanceId } })
    return instance?.accessUrl ?? null
  }

  async redeploy(instanceId: string): Promise<void> {
    const instance = await this.requireInstance(instanceId)

    // Update pairing server script
    this.ensurePairingServer()

    // Restart container to pick up the new script
    const container = this.docker.getContainer(instance.containerName)
    await container.restart({ t: 5 })

    await this.logDeployment(instanceId, 'REDEPLOY', 'SUCCESS', 'Container restarted with updated scripts')
  }

  private async requireInstance(instanceId: string) {
    const instance = await prisma.instance.findUnique({ where: { id: instanceId } })
    if (!instance) throw new Error('Instance not found')
    return instance
  }

  private async logDeployment(instanceId: string, action: string, status: string, message: string, error?: string) {
    await prisma.deploymentLog.create({ data: { instanceId, action, status, message, error } })
  }
}
