// SPDX-License-Identifier: AGPL-3.0-only
// 本地预览：静态托管 toy/，/v2/* 走 proxy/worker.js
// Token 优先读环境变量 BJD_TOKEN，其次读项目根目录 key.txt（参考 key.txt.example）
// 用法：node dev-server.mjs [port]   仅监听 127.0.0.1
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { handle } from './proxy/worker.js'
import { slidingWindowLimiter } from './proxy/limiter.js'

const root = fileURLToPath(new URL('./toy/', import.meta.url)).replace(/[\\/]$/, '') + sep
const port = Number(process.argv[2] || process.env.PORT || 5173)

async function loadToken() {
  if (process.env.BJD_TOKEN) return process.env.BJD_TOKEN.trim()
  try {
    const t = (await readFile(new URL('./key.txt', import.meta.url), 'utf8')).trim()
    if (t && !t.startsWith('#')) return t
  } catch {}
  console.error('未找到布吉岛 Token：请设置环境变量 BJD_TOKEN，或复制 key.txt.example 为 key.txt 并填入 Token')
  process.exit(1)
}

const env = {
  BJD_TOKEN: await loadToken(),
  // 浏览器同源 POST 也会带 Origin，本地预览需放行自身来源；curl 等无 Origin 请求也放行
  ALLOWED_ORIGINS: [
    'https://www.bilibili.com',
    'https://m.bilibili.com',
    'https://www.bilibilitoy.com',
    `http://localhost:${port}`,
    `http://127.0.0.1:${port}`,
  ].join(','),
  ALLOW_NO_ORIGIN: true,
  RL_IP: slidingWindowLimiter(40, 60_000),
  RL_USER_BASIC: slidingWindowLimiter(10, 60_000),
  RL_USER_TRIPLE: slidingWindowLimiter(20, 60_000),
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
}
const MAX_BODY = 4096
const WIN_DEVICE = /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i
const STATUS_TEXT = { 403: 'forbidden', 404: 'not found', 413: 'body too large', 500: 'internal error' }

const fail = status => Object.assign(new Error(STATUS_TEXT[status]), { status })

// 超限后继续读完（丢弃）再回 413，避免直接断开连接
function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', c => {
      size += c.length
      if (size <= MAX_BODY) chunks.push(c)
    })
    req.on('end', () => (size > MAX_BODY ? reject(fail(413)) : resolve(Buffer.concat(chunks))))
    req.on('error', reject)
  })
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${port}`)
    if (url.pathname.startsWith('/v2/')) {
      const body = ['GET', 'HEAD'].includes(req.method) ? undefined : await readRequestBody(req)
      const headers = { ...req.headers, 'cf-connecting-ip': req.socket.remoteAddress }
      const response = await handle(new Request(url, { method: req.method, headers, body }), env)
      res.writeHead(response.status, Object.fromEntries(response.headers))
      res.end(Buffer.from(await response.arrayBuffer()))
      return
    }
    const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1))
    if (rel.split(/[\\/]/).some(seg => WIN_DEVICE.test(seg))) throw fail(404)
    const file = normalize(join(root, rel))
    if (!file.startsWith(root)) throw fail(403)
    if (!TYPES[extname(file)] || !(await stat(file)).isFile()) throw fail(404)
    const data = await readFile(file)
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] })
    res.end(data)
  } catch (e) {
    const status = e.status || (e.code === 'ENOENT' ? 404 : 500)
    if (!res.headersSent) res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end(STATUS_TEXT[status] || 'error')
  }
}).listen(port, '127.0.0.1', () => console.log(`toy dev server: http://localhost:${port}/`))
