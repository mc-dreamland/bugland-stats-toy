// SPDX-License-Identifier: AGPL-3.0-only
// 布吉岛 API 代理（Cloudflare Workers / 任何 Fetch API 运行时）
// 作用：
// 1. 布吉岛 API 的 CORS 只放行 https://mcbjd.net，B站 Toy 页面无法直接调用；
// 2. Token 不能下发到前端，由代理在服务端注入；
// 3. Token 额度由全部用户共享，代理对相同请求做缓存以节省额度。
//
// 环境变量 / 绑定：
//   BJD_TOKEN        布吉岛 OpenAPI Token（必填，wrangler secret put BJD_TOKEN）
//   ALLOWED_ORIGINS  逗号分隔的允许来源，默认 https://www.bilibilitoy.com,https://www.bilibili.com,https://m.bilibili.com
//   ALLOW_NO_ORIGIN  仅本地开发设为真值：放行不带 Origin 的请求（curl 等）
//   RL_IP            可选，按客户端 IP 限流
//   RL_USER_BASIC    可选，按用户限流（基础额度）
//   RL_USER_TRIPLE   可选，按用户限流（三连额度）

const UPSTREAM = 'https://api.mcbjd.net/v2'
// Toy 页面实际托管在 www.bilibilitoy.com；bilibili.com 两个保留以兼容平台跳转
const DEFAULT_ORIGINS = 'https://www.bilibilitoy.com,https://www.bilibili.com,https://m.bilibili.com'
const MAX_BODY = 2048
const MAX_FIELD = 64
const GAMETYPES = ['bedwars', 'skywars', 'vdefense', 'arenapvp', 'anqu', 'kitbattle', 'anni', 'achievement', 'survivalgame']

// 只转发 Toy 用到的接口与字段；ttl 为缓存秒数
const ROUTES = {
  '/player': { ttl: 300, fields: ['username', 'uuid'] },
  '/player/2025total': { ttl: 3600, fields: ['username', 'uuid'] },
  '/gamestats': { ttl: 300, fields: ['username', 'uuid', 'gametype', 'subtype'] },
  '/guild': { ttl: 300, fields: ['guild'] },
  '/leaderboard': { ttl: 300, fields: ['username', 'lb_type'] },
  '/gamelog/user': { ttl: 60, fields: ['username', 'uuid', 'page'] },
  '/gamelog/match': { ttl: 3600, fields: ['match', 'date'] },
}

// 进程内缓存：workers.dev 域名上 Cache API 不生效，至少在同一 isolate 内复用结果
const memo = new Map()
const MEMO_MAX = 500

function corsHeaders(origin) {
  if (!origin) return {}
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Toy-User, X-Toy-Tier',
    'Access-Control-Expose-Headers': 'X-Proxy-Cache',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
}

function json(status, payload, origin) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders(origin) },
  })
}

function rateLimited(reason, tier, origin) {
  return json(429, { code: 429, message: 'too many requests', reason, tier }, origin)
}

function reply(text, origin, cacheState) {
  return new Response(text, {
    status: 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders(origin), 'X-Proxy-Cache': cacheState },
  })
}

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('')
}

// 逐块读取请求体，超过上限立即放弃
async function readBody(request) {
  if (Number(request.headers.get('Content-Length')) > MAX_BODY) return null
  if (!request.body) return ''
  const reader = request.body.getReader()
  const chunks = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAX_BODY) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }
  const all = new Uint8Array(size)
  let offset = 0
  for (const c of chunks) { all.set(c, offset); offset += c.byteLength }
  return new TextDecoder().decode(all)
}

// 只保留白名单字段，值必须是短字符串
function pickFields(path, body, fields) {
  const out = {}
  for (const key of fields) {
    const v = body[key]
    if (v === undefined || v === null || v === '') continue
    if (typeof v !== 'string' && typeof v !== 'number') return null
    const s = String(v)
    if (s.length > MAX_FIELD) return null
    out[key] = s
  }
  if (path === '/gamestats' && !GAMETYPES.includes(out.gametype)) return null
  return Object.keys(out).length ? out : null
}

export async function handle(request, env, ctx) {
  const url = new URL(request.url)
  const origin = request.headers.get('Origin') || ''
  const allowed = (env.ALLOWED_ORIGINS || DEFAULT_ORIGINS).split(',').map(s => s.trim()).filter(Boolean)
  const corsOrigin = origin && allowed.includes(origin) ? origin : ''
  if (!corsOrigin && !(env.ALLOW_NO_ORIGIN && !origin)) return json(403, { code: 403, message: 'origin not allowed' })

  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(corsOrigin) })
  if (request.method !== 'POST') return json(405, { code: 405, message: 'method not allowed' }, corsOrigin)

  const path = url.pathname.replace(/^\/v2/, '').replace(/\/+$/, '')
  const route = Object.hasOwn(ROUTES, path) ? ROUTES[path] : null
  if (!route) return json(404, { code: 404, message: 'unknown endpoint' }, corsOrigin)
  if (!env.BJD_TOKEN) return json(500, { code: 500, message: 'proxy token not configured' }, corsOrigin)

  const raw = await readBody(request)
  if (raw === null) return json(413, { code: 413, message: 'body too large' }, corsOrigin)
  let parsed
  try {
    parsed = JSON.parse(raw || '{}')
  } catch {
    return json(400, { code: 400, message: 'invalid json' }, corsOrigin)
  }
  const body = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? pickFields(path, parsed, route.fields) : null
  if (!body) return json(400, { code: 400, message: 'invalid parameters' }, corsOrigin)
  const canonical = JSON.stringify(body, Object.keys(body).sort())
  const hash = await sha256Hex(path + '\n' + canonical)

  const now = Date.now()
  const hit = memo.get(hash)
  if (hit && hit.expires > now) return reply(hit.text, corsOrigin, 'HIT')
  if (hit) memo.delete(hash)

  const cache = typeof caches !== 'undefined' && caches.default ? caches.default : null
  const cacheKey = cache ? new Request(`${url.origin}/__cache${path}?h=${hash}`) : null
  if (cache) {
    const cached = await cache.match(cacheKey)
    if (cached) return reply(await cached.text(), corsOrigin, 'HIT')
  }

  // 仅在缓存未命中时依次检查 IP 和用户额度
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown'
  const toyUser = request.headers.get('X-Toy-User') || ''
  const hasUser = /^[A-Za-z0-9_-]{1,128}$/.test(toyUser)
  const tier = hasUser && request.headers.get('X-Toy-Tier') === 'triple' ? 'triple' : 'basic'
  if (env.RL_IP) {
    const { success } = await env.RL_IP.limit({ key: ip })
    if (!success) return rateLimited('ip_limit', tier, corsOrigin)
  }
  const userLimiter = tier === 'triple' ? env.RL_USER_TRIPLE : env.RL_USER_BASIC
  if (userLimiter) {
    const { success } = await userLimiter.limit({ key: hasUser ? `u:${toyUser}` : `ip:${ip}` })
    if (!success) return rateLimited('user_limit', tier, corsOrigin)
  }

  let upstream
  try {
    upstream = await fetch(UPSTREAM + path, {
      method: 'POST',
      redirect: 'manual',
      headers: { Authorization: `Bearer ${env.BJD_TOKEN}`, 'Content-Type': 'application/json' },
      body: canonical,
    })
  } catch {
    return json(502, { code: 502, message: 'upstream unreachable' }, corsOrigin)
  }

  const text = await upstream.text()
  let ok = false
  try { ok = upstream.status === 200 && JSON.parse(text).code === 200 } catch {}
  if (!ok) {
    return new Response(text, {
      status: upstream.status >= 300 && upstream.status < 400 ? 502 : upstream.status,
      headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders(corsOrigin), 'X-Proxy-Cache': 'MISS' },
    })
  }

  if (memo.size >= MEMO_MAX) memo.delete(memo.keys().next().value)
  memo.set(hash, { text, expires: now + route.ttl * 1000 })
  if (cache) {
    const put = cache.put(cacheKey, new Response(text, {
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': `public, max-age=${route.ttl}` },
    }))
    if (ctx?.waitUntil) ctx.waitUntil(put)
    else await put
  }
  return reply(text, corsOrigin, 'MISS')
}

export default { fetch: handle }
