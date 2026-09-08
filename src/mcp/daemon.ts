/**
 * 共享 MCP daemon 入口。由 VS Code 扩展按需 spawn（ELECTRON_RUN_AS_NODE=1），
 * 也可以直接 `node dist/mcp-daemon.cjs` 手动起——测试与冒烟走的就是这条路。
 *
 * 生命周期约定（无 leader 架构，靠端口独占保证单例）：
 * - 端口被占（EADDRINUSE）→ 立即以 0 退出：已经有一个 daemon 在服务，
 *   第二个 spawn 天然幂等；
 * - 存活判定：/health 心跳与任何 /mcp 请求都刷新 lastActivity。全部 VS Code
 *   窗口关闭后没有心跳、也没有外部客户端（Claude Code 等）还在调用时，
 *   超过 TTL 自退——不留孤儿进程；反之一个还在工作的无头 agent 会话
 *   靠它自己的流量维持 daemon 存活；
 * - 环境变量：PANORAMA_MCP_PORT（默认 4377）、PANORAMA_MCP_LOCALE
 *   （en | zh-cn，跟随 spawn 它的 VS Code 显示语言）。
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { buildMcpServer, SERVER_NAME } from './server';
import { servicesFor, type McpEnv, type McpFs } from './env';
import { WorkspaceScanner } from './tools/symbols';
import pkg from '../../package.json';

const PORT = Number(process.env.PANORAMA_MCP_PORT ?? 4377);
const HOST = '127.0.0.1';

/** 心跳+流量的联合 TTL。扩展侧每 10s ping 一次，90s 容得下三次丢包。 */
const ACTIVITY_TTL_MS = 90_000;
/** 单次检查间隔 */
const SWEEP_INTERVAL_MS = 15_000;
/** 请求体上限：MCP 请求都小，4MB 已是宽裕 */
const MAX_BODY_BYTES = 4 * 1024 * 1024;

const locale = process.env.PANORAMA_MCP_LOCALE === 'zh-cn' ? 'zh-cn' : 'en';

/**
 * walk 的防爆闸：路径段里跳过 .git / node_modules / 隐藏目录之后，
 * 再多就是这个 root 本身给错了（比如给了 /）。50000 个条目足够任何
 * 真实 mod 仓库，包括全套反编译的 shipped UI。
 */
const MAX_WALK_ENTRIES = 50_000;

function listFiles(root: string): string[] {
  const out: string[] = [];
  const queue: string[] = [root.replace(/\/+$/, '')];
  let visited = 0;
  while (queue.length > 0 && visited < MAX_WALK_ENTRIES) {
    const dir = queue.shift()!;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue; // 读不了的目录当空处理——权限或并发删除都可能
    }
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      visited++;
      const p = `${dir}/${e.name}`;
      if (e.isDirectory()) queue.push(p);
      else if (e.isFile()) out.push(p);
    }
  }
  return out;
}

const fs: McpFs = {
  readFile: (p) => readFileSync(p, 'utf8'),
  exists: (p) => existsSync(p),
  isDirectory: (p) => {
    try {
      return statSync(p).isDirectory();
    } catch {
      return false;
    }
  },
  listFiles,
};

const contentRoots = (process.env.PANORAMA_MCP_ROOTS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter((s) => s.length > 0);

const env: McpEnv = { fs, locale, ...(contentRoots.length > 0 ? { contentRoots } : {}) };
const services = servicesFor(locale);
/** 进程级共享：scanner 的 TTL 缓存跨请求存活（见 buildMcpServer 注释） */
const scanner = new WorkspaceScanner(env);

let lastActivity = Date.now();

function touch(): void {
  lastActivity = Date.now();
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('payload too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(text);
}

/**
 * Streamable HTTP 的 stateless 形态：每个 POST 一个全新 transport+server。
 * Session 语义由客户端每次 initialize 重建，daemon 重启对客户端零感知——
 * 这正是「VS Code 窗口全关后自退、下次按需再起」所需要的性格。
 */
async function handleMcpPost(req: IncomingMessage, res: ServerResponse): Promise<void> {
  touch();
  const raw = await readBody(req);
  let parsed: unknown;
  try {
    parsed = raw.length === 0 ? undefined : JSON.parse(raw.toString('utf8'));
  } catch {
    sendJson(res, 400, { jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' } });
    return;
  }

  const server = buildMcpServer(env, services, scanner);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, parsed);
}

const http = createServer((req, res) => {
  const url = (req.url ?? '').split('?')[0];

  if (url === '/health') {
    touch();
    sendJson(res, 200, { ok: true, server: SERVER_NAME, version: pkg.version, locale });
    return;
  }

  if (url !== '/mcp') {
    sendJson(res, 404, { error: 'not found' });
    return;
  }

  if (req.method === 'POST') {
    handleMcpPost(req, res).catch(() => {
      if (!res.headersSent) sendJson(res, 500, { error: 'internal error' });
    });
    return;
  }

  // stateless：不支持 GET（SSE 常驻流）与 DELETE（会话销毁）。
  // 405 + Allow 是规范给的应答。
  res.writeHead(405, { allow: 'POST' }).end();
});

http.on('error', (err) => {
  const code = (err as NodeJS.ErrnoException).code;
  if (code === 'EADDRINUSE') {
    // 已有 daemon 占着端口——幂等退出，不是失败
    process.exit(0);
  }
  // 其他错误（权限等）写真退出码，让 spawn 方能看到
  console.error(`panorama-mcp: ${String(err)}`);
  process.exit(1);
});

http.listen(PORT, HOST, () => {
  // stdout 一行 JSON：spawn 方（以及人）确认起来最方便。
  // PORT=0 时上报**实际**分到的端口——测试用它拿随机端口，永不撞车
  const actual = http.address();
  const boundPort = actual && typeof actual === 'object' ? actual.port : PORT;
  console.log(JSON.stringify({ panoramaMcp: true, port: boundPort, host: HOST, locale, version: pkg.version }));
});

const sweeper = setInterval(() => {
  if (Date.now() - lastActivity > ACTIVITY_TTL_MS) {
    clearInterval(sweeper);
    http.close(() => process.exit(0));
    // 还有挂着的连接时也只给 1s 宽限——闲置连接不值得为它违背 TTL 语义
    setTimeout(() => process.exit(0), 1000).unref();
  }
}, SWEEP_INTERVAL_MS);
sweeper.unref();

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
