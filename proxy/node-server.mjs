// SPDX-License-Identifier: AGPL-3.0-only
// 自建服务器部署入口：Node ≥ 20，放在 nginx 后面，只监听 127.0.0.1
// 环境变量：
//   BJD_TOKEN        必填，布吉岛 OpenAPI Token
//   ALLOWED_ORIGINS  可选，默认 https://www.bilibilitoy.com,https://www.bilibili.com,https://m.bilibili.com
//   PORT             可选，默认 8787
//   RL_IP / RL_USER_BASIC / RL_USER_TRIPLE  可选，每分钟次数，默认 40 / 10 / 20
// 客户端 IP 取自 nginx 设置的 X-Real-IP（客户端自带的 CF-Connecting-IP 会被丢弃）
import { createServer } from 'node:http'
import { handle } from './worker.js'
import { slidingWindowLimiter } from './limiter.js'

const major = Number(process.versions.node.split('.')[0])
if (major < 20) {
  console.error(`需要 Node.js 20 及以上，当前 ${process.version}`)
  process.exit(1)
}
if (!process.env.BJD_TOKEN) {
  console.error('缺少环境变量 BJD_TOKEN')
  process.exit(1)
}

const port = Number(process.env.PORT || 8787)
const perMinute = (name, fallback) => slidingWindowLimiter(Number(process.env[name] || fallback), 60_000)
const env = {
  BJD_TOKEN: process.env.BJD_TOKEN.trim(),
  ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS || undefined,
  RL_IP: perMinute('RL_IP', 40),
  RL_USER_BASIC: perMinute('RL_USER_BASIC', 10),
  RL_USER_TRIPLE: perMinute('RL_USER_TRIPLE', 20),
}
const MAX_BODY = 4096

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', c => {
      size += c.length
      if (size <= MAX_BODY) chunks.push(c)
    })
    req.on('end', () => resolve(size > MAX_BODY ? null : Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://127.0.0.1:${port}`)
    if (url.pathname === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'text/plain' })
      res.end('ok')
      return
    }
    if (!url.pathname.startsWith('/v2/')) {
      res.writeHead(404, { 'Content-Type': 'text/plain' })
      res.end('not found')
      return
    }
    const body = ['GET', 'HEAD'].includes(req.method) ? undefined : await readBody(req)
    if (body === null) {
      res.writeHead(413, { 'Content-Type': 'text/plain' })
      res.end('body too large')
      return
    }
    const headers = { ...req.headers }
    delete headers['cf-connecting-ip']
    headers['cf-connecting-ip'] = req.headers['x-real-ip'] || req.socket.remoteAddress || 'unknown'
    const response = await handle(new Request(url, { method: req.method, headers, body }), env)
    res.writeHead(response.status, Object.fromEntries(response.headers))
    res.end(Buffer.from(await response.arrayBuffer()))
  } catch (e) {
    console.error(e)
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain' })
    res.end('internal error')
  }
}).listen(port, '127.0.0.1', () => console.log(`bjd proxy listening on 127.0.0.1:${port}`))
