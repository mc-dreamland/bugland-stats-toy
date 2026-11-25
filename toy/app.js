// SPDX-License-Identifier: AGPL-3.0-only
;(() => {
  'use strict'

  const API = String((window.BJD_TOY_CONFIG || {}).apiBase || '/v2').replace(/\/+$/, '')
  const toy = window.toy || null
  const $ = sel => document.querySelector(sel)
  const params = new URLSearchParams(location.search)
  const localPreview = (location.hostname === 'localhost' || location.hostname === '127.0.0.1') && params.get('forceGate') !== '1'
  const MINUTE = 60_000
  const TRIPLE_HINT = '三连任意一个作者近一年视频可提升到 20 次'
  let unlocked = false
  let tier = 'basic'
  let toyOpenId = ''
  const quotaFor = tier => tier === 'triple' ? 20 : 10
  const effectiveQuota = () => quotaFor(toyOpenId ? tier : 'basic')

  // ---------------------------------------------------------------- 字典
  const BW_MODES = {
    bwxp32: '经验 4队8人',
    bwxp8x4: '经验 8队4人',
    bwxp4x8: '经验 4x8',
    bwxp64: '经验 64人',
    bw12: '4队3人',
  }
  const SW_MODES = { solo: '单人', swrdouble: '双人' }
  const LOG_TYPES = { ARENAPVP: '竞技场', BW8: '起床战争 BW8', BW16: '起床战争 BW16', BWXP32: '起床·经验4队8人', BWXP8X4: '起床·经验8队4人' }
  const ITEMS = {
    GOLDEN_APPLE: '金苹果', ENCHANTED_GOLDEN_APPLE: '附魔金苹果', ENDER_PEARL: '末影珍珠', FIRE_CHARGE: '火焰弹',
    TNT: 'TNT', BLAZE_ROD: '烈焰棒', CHEST: '箱子', SNOWBALL: '雪球', WOLF_SPAWN_EGG: '狼刷怪蛋', EGG: '鸡蛋',
    TOTEM: '不死图腾', SLIME_BALL: '粘液球', END_CRYSTAL: '末影水晶',
    IRON_INGOT: '铁锭', GOLD_INGOT: '金锭', DIAMOND: '钻石', EMERALD: '绿宝石',
  }
  const UPGRADES = {
    PROTECTION: '保护', SHARPNESS: '锋利', FAST_DIG: '疯狂矿工', HEAL: '治愈池', IRON_FORGE: '锻炉',
    TRAP: '陷阱', ALARM_TRAP: '警报陷阱', COUNTER_OFFENSIVE_TRAP: '反击陷阱', DEFENSE: '防御',
  }
  const LB_MODE = { bw: '起床战争(全部模式)', bwxp32: '起床战争(经验4队8人)', bwxp8x4: '起床战争(经验8队4人)', bw12: '起床战争(4队3人)' }
  const LB_STAT = { bed_destory: '拆床', destory_bed: '拆床', final_kills: '最终击杀', fk: '最终击杀', win: '胜利', kills: '击杀' }
  // 提亮原版深色，保证深色面板上的等阶可读。
  const MC_COLORS = {
    0: '#8e8e8e', 1: '#7777ff', 2: '#00aa00', 3: '#00aaaa', 4: '#f06767', 5: '#e072e0', 6: '#ffaa00', 7: '#aaaaaa',
    8: '#999999', 9: '#8383ff', a: '#55ff55', b: '#55ffff', c: '#ff5555', d: '#ff55ff', e: '#ffff55', f: '#ffffff',
  }
  const OTHER_GAMES = [
    ['arenapvp', '竞技场'], ['kitbattle', '职业战争'], ['vdefense', '村庄保卫'],
    ['survivalgame', '饥饿游戏'], ['anqu', '暗区'], ['anni', '核心战争'],
  ]
  const TABS = [
    ['overview', '总览'], ['bedwars', '起床战争'], ['skywars', '空岛战争'], ['other', '其他模式'],
    ['gamelog', '对局记录'], ['rank', '排行榜'], ['guild', '公会'], ['y2025', '2025 年度'],
  ]

  // ---------------------------------------------------------------- 工具
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
  const num = v => (typeof v === 'number' && isFinite(v) ? Math.round(v * 100) / 100 : 0)
  const fmt = v => num(v).toLocaleString('zh-CN')
  const ratio = (a, b) => (b ? (num(a) / num(b)).toFixed(2) : num(a) ? '∞' : '0.00')
  const pct = (a, b) => (b ? ((num(a) / num(b)) * 100).toFixed(1) + '%' : '-')
  const pad = n => String(n).padStart(2, '0')
  const date = ms => {
    const d = new Date(Number(ms))
    return isNaN(d) ? '-' : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  }
  const dateTime = iso => {
    const d = new Date(iso)
    return isNaN(d) ? '-' : `${date(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  }
  const duration = (a, b) => {
    const s = Math.round((new Date(b) - new Date(a)) / 1000)
    return isFinite(s) && s > 0 ? `${Math.floor(s / 60)}分${pad(s % 60)}秒` : ''
  }

  // Minecraft § 颜色码 → HTML
  function mcText(raw) {
    let out = ''
    let color = '#FFFFFF'
    let bold = false
    const parts = String(raw ?? '').split('§')
    parts.forEach((part, i) => {
      let text = part
      if (i > 0 && part.length) {
        const code = part[0].toLowerCase()
        text = part.slice(1)
        if (MC_COLORS[code]) { color = MC_COLORS[code]; bold = false }
        else if (code === 'l') bold = true
        else if (code === 'r') { color = '#FFFFFF'; bold = false }
      }
      if (text) out += `<span style="color:${color}${bold ? ';font-weight:900' : ''}">${esc(text)}</span>`
    })
    return out || '<span style="color:#98a39a">-</span>'
  }

  // 由昵称生成 8×8 像素头像（服务端不提供皮肤）
  function pixelAvatar(name) {
    let h = 2166136261
    for (const ch of name) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619) >>> 0 }
    const rand = () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return (h >>> 0) / 4294967296 }
    const hue = Math.floor(rand() * 360)
    const palette = [`hsl(${hue} 45% 28%)`, `hsl(${hue} 55% 42%)`, `hsl(${(hue + 30) % 360} 60% 58%)`, `hsl(${hue} 20% 82%)`]
    const c = document.createElement('canvas')
    c.width = c.height = 8
    const g = c.getContext('2d')
    for (let y = 0; y < 8; y++) for (let x = 0; x < 4; x++) {
      g.fillStyle = palette[Math.floor(rand() * palette.length)]
      g.fillRect(x, y, 1, 1)
      g.fillRect(7 - x, y, 1, 1)
    }
    g.fillStyle = '#1e1e1f'
    g.fillRect(2, 4, 1, 1); g.fillRect(5, 4, 1, 1)
    return c.toDataURL()
  }

  // ---------------------------------------------------------------- 网络
  class ApiError extends Error {}

  async function api(path, body) {
    if (!unlocked) throw new ApiError('请先完成关注检测')
    const headers = { 'Content-Type': 'application/json', 'X-Toy-Tier': tier }
    if (toyOpenId) headers['X-Toy-User'] = toyOpenId
    let res
    try {
      res = await fetch(API + path, { method: 'POST', headers, body: JSON.stringify(body) })
    } catch {
      throw new ApiError('网络异常，请检查网络后重试')
    }
    if (res.headers.get('X-Proxy-Cache') === 'MISS') {
      missTimes.push(performance.now())
      updateRemaining()
    }
    if (res.status === 429) {
      const limit = await res.json().catch(() => null)
      if (limit?.reason === 'user_limit') {
        const quota = quotaFor(limit.tier)
        // 服务端已判定用完（可能来自其他页面/设备），本地计数同步为 0 剩余
        const now = performance.now()
        while (missTimes.length < quota) missTimes.push(now)
        updateRemaining()
        const hint = quota === 10 ? `。${TRIPLE_HINT}` : ''
        throw new ApiError(`本分钟查询次数已用完（${quota} 次/分钟），请稍后再试${hint}`)
      }
      throw new ApiError('当前网络请求过多，请稍后再试')
    }
    let json
    try { json = await res.json() } catch { throw new ApiError(`服务暂时不可用（${res.status}）`) }
    if (!res.ok || json.code !== 200) {
      if (json.code === 429) throw new ApiError('查询太频繁了，请稍等一会儿再试')
      throw new ApiError(json.message || `服务暂时不可用（${res.status}）`)
    }
    const data = json.data || {}
    if (data.error) throw new ApiError(data.error === 'User not found' ? '没有找到相关数据' : data.error)
    return data
  }

  // 每位玩家的请求按 key 记忆，切换 tab 不重复请求（接口额度有限）
  const state = { name: '', uuid: '', cache: new Map(), tab: 'overview', other: 'arenapvp', logPage: 1, seq: 0 }
  function load(key, fn) {
    if (!state.cache.has(key)) {
      const p = fn().catch(e => { state.cache.delete(key); throw e })
      state.cache.set(key, p)
    }
    return state.cache.get(key)
  }
  const who = () => (state.uuid ? { uuid: state.uuid } : { username: state.name })
  const getPlayer = () => load('player', () => api('/player', { username: state.name }))
  const getStats = type => load('gs:' + type, () => api('/gamestats', { ...who(), gametype: type }))

  // ---------------------------------------------------------------- 本地 / 云存储
  const LS_RECENT = 'bjd_recent'
  const LS_MINE = 'bjd_mine'
  const CLOUD_MINE = 'bjd_mine'
  const recent = {
    get() { try { return JSON.parse(localStorage.getItem(LS_RECENT)) || [] } catch { return [] } },
    add(name) {
      const list = [name, ...this.get().filter(n => n !== name)].slice(0, 8)
      try { localStorage.setItem(LS_RECENT, JSON.stringify(list)) } catch {}
    },
  }
  let mine = ''
  try { mine = localStorage.getItem(LS_MINE) || '' } catch {}

  async function supports(ability) {
    if (!toy || typeof toy.isSupport !== 'function') return false
    try { return await toy.isSupport(ability) } catch { return false }
  }

  async function syncMineFromCloud() {
    if (!(await supports('getCloudStorage'))) return
    try {
      const data = await toy.getCloudStorage([CLOUD_MINE])
      if (data[CLOUD_MINE] && data[CLOUD_MINE] !== mine) {
        mine = data[CLOUD_MINE]
        try { localStorage.setItem(LS_MINE, mine) } catch {}
        renderQuick()
      }
    } catch { /* 未登录或预览态：沿用本地记录 */ }
  }

  async function setMine(name) {
    mine = name
    try { localStorage.setItem(LS_MINE, name) } catch {}
    renderQuick()
    renderProfileActions()
    if (await supports('setCloudStorage')) {
      try {
        await toy.setCloudStorage({ [CLOUD_MINE]: name })
        toast('已绑定为我的 ID，换设备登录也能用')
        return
      } catch { /* 未登录 */ }
    }
    toast('已绑定为我的 ID（仅本机）')
  }

  // ---------------------------------------------------------------- UI 基础
  let toastTimer
  function toast(text) {
    const el = $('#toast')
    el.textContent = text
    el.hidden = false
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => { el.hidden = true }, 2400)
  }

  const loading = text => `<div class="panel state"><div class="loader"></div>${esc(text || '读取中…')}</div>`
  const errorBox = (e, retry) =>
    `<div class="panel state error">${esc(e.message || '加载失败')}${retry ? `<br><button class="btn btn-sm" data-action="${retry}">重试</button>` : ''}</div>`
  const emptyBox = text => `<div class="panel state">${esc(text)}</div>`
  const stat = (label, value, cls = '') =>
    `<div class="stat ${cls}"><span class="stat-label">${esc(label)}</span><span class="stat-value">${value}</span></div>`
  const card = (title, inner, extra = '') =>
    `<section class="panel card"><h3 class="card-title"><span>${title}</span>${extra}</h3>${inner}</section>`
  const kv = (obj, dict) => {
    const entries = Object.entries(obj || {}).filter(([, v]) => num(v) > 0).sort((a, b) => b[1] - a[1])
    return entries.length ? `<div class="kv">${entries.map(([k, v]) => `<span>${esc(dict[k] || k)}<b>${fmt(v)}</b></span>`).join('')}</div>` : ''
  }

  function openModal(title, html) {
    $('#modal-title').textContent = title
    $('#modal-body').innerHTML = html
    $('#modal').hidden = false
    document.body.style.overflow = 'hidden'
  }
  function closeModal() {
    $('#modal').hidden = true
    document.body.style.overflow = ''
  }
  const modalOpenFor = title => !$('#modal').hidden && $('#modal-title').textContent === title

  // 防止慢请求覆盖新内容：渲染前比对序号
  async function renderInto(el, html, task) {
    const seq = ++state.seq
    el.innerHTML = html
    try {
      const out = await task()
      if (seq === state.seq) el.innerHTML = out
    } catch (e) {
      if (seq === state.seq) el.innerHTML = errorBox(e, 'retry-tab')
    }
  }

  // ---------------------------------------------------------------- 搜索
  function renderQuick() {
    const list = recent.get().filter(n => n !== mine)
    const parts = []
    if (mine) parts.push(`<button class="chip mine" type="button" data-action="search" data-name="${esc(mine)}">★ 我的：${esc(mine)}</button>`)
    if (list.length) {
      parts.push('<span class="quick-label">最近</span>')
      parts.push(...list.map(n => `<button class="chip" type="button" data-action="search" data-name="${esc(n)}">${esc(n)}</button>`))
    }
    $('#quick').innerHTML = parts.join('')
  }

  async function search(name) {
    if (!unlocked) return
    name = String(name || '').trim()
    if (!name) { toast('请输入玩家昵称'); return }
    closeModal()
    $('#q').value = name
    $('#q').blur()
    state.name = name
    state.uuid = ''
    state.cache = new Map()
    state.logPage = 1
    state.other = 'arenapvp'
    $('#empty').hidden = true
    $('#result').hidden = false
    $('#profile').innerHTML = `<div class="state" style="grid-column:1/-1"><div class="loader"></div>查找 ${esc(name)}…</div>`
    $('#tabs').innerHTML = ''
    $('#tabpanel').innerHTML = ''
    const seq = ++state.seq
    try {
      const p = await getPlayer()
      if (seq !== state.seq) return
      if (!p.playername) throw new ApiError(`没有找到玩家「${name}」，请检查昵称是否正确`)
      state.name = p.playername
      state.uuid = p.uuid || ''
      recent.add(state.name)
      renderQuick()
      params.set('u', state.name)
      history.replaceState(null, '', `?${params}`)
      renderProfile(p)
      selectTab('overview')
    } catch (e) {
      if (seq !== state.seq) return
      $('#profile').innerHTML = `<div class="state error" style="grid-column:1/-1">${esc(e.message)}</div>`
    }
  }

  function renderProfile(p) {
    $('#profile').innerHTML = `
      <div class="avatar" style="background-image:url(${pixelAvatar(p.playername)})"></div>
      <div>
        <h2 class="profile-name">${esc(p.playername)}</h2>
        <div class="profile-meta">
          <span class="tag">Lv.${esc(p.bjdxp_level || 0)}</span>
          ${num(Number(p.vip_level)) > 0 ? `<span class="tag gold">VIP ${esc(p.vip_level)}</span>` : ''}
          ${p.guild_name ? `<span class="tag gray">${esc(p.guild_name)}</span>` : ''}
          <span id="ban-tag"></span>
        </div>
      </div>
      <div class="profile-actions" id="profile-actions"></div>`
    renderProfileActions()
    $('#tabs').innerHTML = TABS.map(([id, label]) =>
      `<button class="btn" type="button" role="tab" data-action="tab" data-tab="${id}">${label}</button>`).join('')
  }

  async function renderProfileActions() {
    const el = $('#profile-actions')
    if (!el || !state.name) return
    const name = state.name
    const share = (await supports('share')) ? 'share' : (await supports('getQrCode')) ? 'qr' : ''
    if (name !== state.name || !$('#profile-actions')) return
    el.innerHTML = [
      mine === name ? '<span class="tag">★ 我的 ID</span>' : '<button class="btn btn-sm" type="button" data-action="bind">设为我的 ID</button>',
      share === 'share' ? '<button class="btn btn-sm btn-primary" type="button" data-action="share">分享</button>' : '',
      share === 'qr' ? '<button class="btn btn-sm btn-primary" type="button" data-action="qr">扫码到手机</button>' : '',
    ].join('')
  }

  function selectTab(id) {
    state.tab = id
    document.querySelectorAll('#tabs .btn').forEach(b => {
      const on = b.dataset.tab === id
      b.classList.toggle('is-active', on)
      b.setAttribute('aria-selected', on)
      if (on) b.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    })
    const el = $('#tabpanel')
    const task = { overview: viewOverview, bedwars: viewBedwars, skywars: viewSkywars, other: viewOther,
      gamelog: viewGamelog, rank: viewRank, guild: viewGuild, y2025: view2025 }[id]
    renderInto(el, loading(), task)
  }

  // ---------------------------------------------------------------- 各页
  function bwTotals(bw) {
    const t = { game: 0, win: 0, lose: 0, kills: 0, deaths: 0, final_kills: 0, final_deaths: 0, bed_destory: 0, bed_lose: 0 }
    for (const m of Object.values(bw || {})) for (const k in t) t[k] += num(m[k])
    return t
  }

  function markBanned(d) {
    const el = $('#ban-tag')
    if (el && d && d.banned) el.outerHTML = '<span class="tag red">封禁中</span>'
  }

  async function viewOverview() {
    const [p, bw] = await Promise.all([getPlayer(), getStats('bedwars')])
    markBanned(bw)
    const ranks = [['起床战争等阶', p.bwxp_show], ['空岛战争等阶', p.swxp_show], ['村庄保卫等阶', p.vdxp_show]]
      .filter(([, v]) => v)
      .map(([label, v]) => `<div class="rank-row"><span class="label">${label}</span><span class="mc">${mcText(v)}</span></div>`).join('')
    const t = bwTotals(bw.bedwars)
    const game = num(bw.total_game) || t.game
    const win = num(bw.total_win) || t.win
    return [
      card('<span class="eyebrow">RANK</span> 等阶', ranks ? `<div class="ranks">${ranks}</div>` : emptyBox('暂无等阶数据')),
      card('<span class="eyebrow">BEDWARS</span> 起床战争总览', game ? `<div class="stats">
        ${stat('总场次', fmt(game))}
        ${stat('胜场', fmt(win), 'good')}
        ${stat('胜率', pct(win, game), 'hl')}
        ${stat('拆床', fmt(num(bw.total_bed_destroy) || t.bed_destory))}
        ${stat('最终击杀', fmt(num(bw.total_fk) || t.final_kills), 'hl')}
        ${stat('FKDR', ratio(t.final_kills, t.final_deaths))}
      </div>` : emptyBox('还没有起床战争记录')),
      card('<span class="eyebrow">PROFILE</span> 基础信息', `<div class="stats">
        ${stat('布吉岛等级', fmt(Number(p.bjdxp_level) || 0), 'hl')}
        ${stat('VIP 等级', esc(p.vip_level || '0'))}
        ${stat('公会', esc(p.guild_name || '无'))}
      </div>`),
    ].join('')
  }

  function modeCard(name, code, m, extraStats, details) {
    return `<div class="panel dark mode">
      <div class="mode-head"><span class="mode-name">${esc(name)}</span><span class="mode-code">${esc(code)}</span></div>
      <div class="stats">${extraStats}</div>
      ${details ? `<details class="more"><summary>道具与升级</summary>${details}</details>` : ''}
    </div>`
  }

  async function viewBedwars() {
    const d = await getStats('bedwars')
    markBanned(d)
    const modes = Object.entries(d.bedwars || {}).filter(([, m]) => num(m.game) > 0).sort((a, b) => num(b[1].game) - num(a[1].game))
    if (!modes.length) return emptyBox('还没有起床战争记录')
    const t = bwTotals(d.bedwars)
    const summary = card('<span class="eyebrow">TOTAL</span> 全模式合计', `<div class="stats">
      ${stat('场次', fmt(t.game))}${stat('胜率', pct(t.win, t.game), 'hl')}
      ${stat('KD', ratio(t.kills, t.deaths))}${stat('FKDR', ratio(t.final_kills, t.final_deaths), 'hl')}
      ${stat('拆床', fmt(t.bed_destory))}${stat('BBLR', ratio(t.bed_destory, t.bed_lose))}
    </div>`)
    const list = modes.map(([code, m]) => modeCard(BW_MODES[code] || code.toUpperCase(), code, m, `
      ${stat('场次', fmt(m.game))}
      ${stat('胜 / 负', `${fmt(m.win)} / ${fmt(m.lose)}`)}
      ${stat('胜率', pct(m.win, m.game), 'hl')}
      ${stat('击杀', fmt(m.kills))}
      ${stat('死亡', fmt(m.deaths))}
      ${stat('KD', ratio(m.kills, m.deaths))}
      ${stat('最终击杀', fmt(m.final_kills), 'good')}
      ${stat('FKDR', ratio(m.final_kills, m.final_deaths), 'hl')}
      ${stat('拆床 / 被拆', `${fmt(m.bed_destory)} / ${fmt(m.bed_lose)}`)}`,
      kv(m.use_item, ITEMS) + kv(m.upgrade, UPGRADES))).join('')
    return summary + `<div class="modes">${list}</div>`
  }

  async function viewSkywars() {
    const d = await getStats('skywars')
    markBanned(d)
    const sw = d.skywars || {}
    const modes = Object.entries(sw).filter(([k, m]) => k !== 'effect' && num(m.game) > 0).sort((a, b) => num(b[1].game) - num(a[1].game))
    if (!modes.length) return emptyBox('还没有空岛战争记录')
    const eff = sw.effect || {}
    const summary = card('<span class="eyebrow">TOTAL</span> 空岛战争合计', `<div class="stats">
      ${stat('场次', fmt(d.total_game))}${stat('胜场', fmt(d.total_win), 'good')}
      ${stat('胜率', pct(d.total_win, d.total_game), 'hl')}${stat('击杀', fmt(d.total_kills))}
      ${eff.kit ? stat('当前职业', esc(eff.kit)) : ''}
    </div>`)
    const list = modes.map(([code, m]) => modeCard(SW_MODES[code] || code.toUpperCase(), code, m, `
      ${stat('场次', fmt(m.game))}
      ${stat('胜 / 负', `${fmt(m.win)} / ${fmt(m.lose)}`)}
      ${stat('胜率', pct(m.win, m.game), 'hl')}
      ${stat('击杀', fmt(m.kills))}
      ${stat('远程击杀', fmt(m.projectileKills))}
      ${stat('KD', ratio(m.kills, m.deaths), 'hl')}`,
      kv(m.use_item, ITEMS) + kv(m.special_item, ITEMS))).join('')
    return summary + `<div class="modes">${list}</div>`
  }

  function otherBody(type, d) {
    const r = d.result || d
    switch (type) {
      case 'arenapvp': {
        if (!r.username && !r.kills) return null
        const elos = Object.entries(r)
          .filter(([k, v]) => /^elo.+elo$/.test(k) && typeof v === 'number')
          .map(([k, v]) => [k.slice(3, -3), v]).sort((a, b) => b[1] - a[1])
        return `<div class="stats">
          ${stat('综合 ELO', fmt(r.globalElo), 'hl')}${stat('击杀', fmt(r.kills))}${stat('死亡', fmt(r.deaths))}
          ${stat('KD', ratio(r.kills, r.deaths), 'hl')}${stat('团战胜场', fmt(r.partyVsPartyWins))}${stat('Sumo 胜场', fmt(r.sumoWins))}
        </div>${elos.length ? `<details class="more" open><summary>各模式 ELO</summary><div class="kv">${elos.map(([k, v]) => `<span>${esc(k)}<b>${fmt(v)}</b></span>`).join('')}</div></details>` : ''}`
      }
      case 'kitbattle':
        if (!r.username && !r.kills) return null
        return `<div class="stats">
          ${stat('段位', esc(r.rank || '-'), 'hl')}${stat('击杀', fmt(r.kills))}${stat('死亡', fmt(r.deaths))}
          ${stat('KD', ratio(r.kills, r.deaths), 'hl')}${stat('挑战胜场', fmt(r.challenge_wins))}${stat('锦标赛胜场', fmt(r.tournament_wins))}
          ${stat('金币', fmt(r.coins))}${stat('经验', fmt(r.dataexp))}${stat('技能使用', fmt(r.abilities_used))}
        </div>${r.kits ? `<details class="more"><summary>已解锁职业</summary><div class="kv">${String(r.kits).split(/,\s*/).map(k => `<span>${esc(k)}</span>`).join('')}</div></details>` : ''}`
      case 'vdefense':
        if (!r.name && !r.gamesPlayed) return null
        return `<div class="stats">
          ${stat('等级', fmt(r.level), 'hl')}${stat('最高波次', fmt(r.highestWave), 'hl')}${stat('场次', fmt(r.gamesPlayed))}
          ${stat('胜 / 负', `${fmt(r.wins)} / ${fmt(r.loses)}`)}${stat('击杀', fmt(r.kills))}${stat('死亡', fmt(r.deaths))}
          ${stat('经验', `${fmt(r.exp)} / ${fmt(r.nextLevelExp)}`)}
        </div>`
      case 'survivalgame': {
        const sg = d.survivalgames
        if (!sg) return null
        const modes = Object.entries(sg).filter(([, m]) => num(m.game) > 0)
        return `<div class="stats">
          ${stat('场次', fmt(d.total_game))}${stat('胜场', fmt(d.total_win), 'good')}
          ${stat('胜率', pct(d.total_win, d.total_game), 'hl')}${stat('击杀', fmt(d.total_kills))}
        </div><div class="modes" style="margin-top:10px">${modes.map(([code, m]) => modeCard(code === 'sgssolo' ? '单人' : code === 'sgsteam' ? '组队' : code, code, m, `
          ${stat('场次', fmt(m.game))}${stat('胜场', fmt(m.win), 'good')}${stat('击杀', fmt(m.kills))}${stat('KD', ratio(m.kills, m.deaths), 'hl')}`)).join('')}</div>`
      }
      case 'anqu':
        if (!d.name && !d.battle) return null
        return `<div class="stats">
          ${stat('对局', fmt(d.battle))}${stat('失败', fmt(d.fail))}${stat('开箱', fmt(d.chest))}${stat('进食', fmt(d.eat))}
          ${stat('游玩时长', d.stime != null ? fmt(d.stime) + ' 秒' : '-')}
        </div>`
      default: {
        const rest = Object.entries(d).filter(([k, v]) => typeof v === 'number' && !['ttl'].includes(k))
        return rest.length ? `<div class="stats">${rest.map(([k, v]) => stat(k, fmt(v))).join('')}</div>` : null
      }
    }
  }

  async function viewOther() {
    const type = state.other
    const label = OTHER_GAMES.find(g => g[0] === type)[1]
    const chips = `<div class="subtabs">${OTHER_GAMES.map(([id, name]) =>
      `<button class="btn btn-sm${id === type ? ' btn-primary' : ''}" type="button" data-action="other" data-game="${id}">${name}</button>`).join('')}</div>`
    let body
    try {
      const d = await getStats(type)
      markBanned(d)
      body = otherBody(type, d) || emptyBox(`还没有${label}记录`)
    } catch (e) {
      body = errorBox(e, 'retry-tab')
    }
    return `<section class="panel card">${chips}</section>` + card(`<span class="eyebrow">${esc(type.toUpperCase())}</span> ${label}`, body)
  }

  async function viewGamelog() {
    const page = state.logPage
    const d = await load('log:' + page, () => api('/gamelog/user', { ...who(), page: String(page) }))
    const rows = d.data || []
    if (!rows.length && page === 1) return emptyBox('最近没有对局记录')
    const list = rows.map(r => `
      <button class="row" type="button" data-action="match" data-id="${esc(r.matchId)}" data-date="${esc(r.date)}" data-type="${esc(r.type)}">
        <span class="wl ${r.win ? 'win' : 'lose'}">${r.win ? '胜' : '负'}</span>
        <span class="row-main"><span class="row-title">${esc(LOG_TYPES[r.type] || r.type)}</span><span class="row-sub">${esc(r.date)}</span></span>
        <span class="row-side" style="color:var(--muted);font-size:.8rem">详情 ›</span>
      </button>`).join('')
    const more = rows.length >= num(d.pageSize || 10)
    return card('<span class="eyebrow">MATCHES</span> 最近对局', `
      ${rows.length ? `<div class="list">${list}</div>` : emptyBox('没有更多记录了')}
      <div class="pager">
        <button class="btn btn-sm" type="button" data-action="page" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}>上一页</button>
        <span>第 ${page} 页</span>
        <button class="btn btn-sm" type="button" data-action="page" data-page="${page + 1}" ${more ? '' : 'disabled'}>下一页</button>
      </div>`)
  }

  function lbLabel(it) {
    if (/[\u4e00-\u9fa5]/.test(it.cn_type || '')) return it.cn_type
    const m = /^([a-z]+\d*(?:x\d+)?)_(.+)_(all|\d{4})_([a-z]+)$/.exec(it.type || '')
    if (!m) return it.cn_type || it.type
    const [, mode, statKey, period, platform] = m
    const periodText = period === 'all' ? '总榜' : `${period} 年榜`
    const platformText = platform === 'java' ? '[端游]' : `[${platform}]`
    return `${LB_MODE[mode] || mode.toUpperCase()}${LB_STAT[statKey] || statKey}${periodText}${platformText}`
  }

  const topCls = n => (n === 1 ? 't1' : n === 2 ? 't2' : n === 3 ? 't3' : '')

  async function viewRank() {
    const d = await load('lb', () => api('/leaderboard', { username: state.name }))
    const list = (d.result || []).slice().sort((a, b) => a.top - b.top)
    if (!list.length) return emptyBox('暂未登上任何排行榜')
    return card('<span class="eyebrow">LEADERBOARD</span> 在榜情况', `<div class="list">${list.map(it => `
      <button class="row" type="button" data-action="board" data-type="${esc(it.type)}" data-label="${esc(lbLabel(it))}">
        <span class="top ${topCls(it.top)}">#${fmt(it.top)}</span>
        <span class="row-main"><span class="row-title">${esc(lbLabel(it))}</span><span class="row-sub">点击查看榜单</span></span>
        <span class="row-side">${fmt(it.score)}</span>
      </button>`).join('')}</div>`, `<small>${list.length} 个榜单</small>`)
  }

  const ROLE_ORDER = ['会长', '副会长', '管理员', '管理', '精英', '成员']
  const roleRank = r => { const i = ROLE_ORDER.indexOf(r); return i < 0 ? ROLE_ORDER.length : i }

  async function viewGuild() {
    const p = await getPlayer()
    if (!p.guild_name) return emptyBox('这位玩家还没有加入公会')
    const g = await load('guild', () => api('/guild', { guild: p.guild_name.replace(/ /g, '-') }))
    const s = g.guildSetting || {}
    const members = (g.members || []).slice().sort((a, b) =>
      roleRank(a.role) - roleRank(b.role) || Number(b.online) - Number(a.online) || String(a.playerName).localeCompare(String(b.playerName), 'zh'))
    const online = members.filter(m => m.online).length
    const notices = [...(g.broadcast || []), s.DESC].filter(Boolean)
    return [
      card(`<span class="eyebrow">GUILD</span> ${esc(g.name)}`, `
        <div class="stats">
          ${stat('等级', fmt(g.level), 'hl')}
          ${stat('成员', `${members.length}${s.maxMember ? ' / ' + fmt(s.maxMember) : ''}`)}
          ${stat('在线', fmt(online), 'good')}
          ${g.tag ? stat('标签', esc(g.tag)) : ''}
          ${stat('加入方式', s.INVITE_ONLY ? '仅邀请' : '开放')}
        </div>
        ${notices.length ? `<div class="list" style="margin-top:10px">${notices.map(n => `<div class="notice">${esc(n)}</div>`).join('')}</div>` : ''}`),
      card('<span class="eyebrow">MEMBERS</span> 成员', `<div class="list">${members.map(m => `
        <button class="row" type="button" data-action="search" data-name="${esc(m.playerName)}">
          <span class="online ${m.online ? 'on' : ''}"></span>
          <span class="row-main"><span class="row-title">${esc(m.playerName)}</span></span>
          <span class="row-side"><span class="tag ${m.role === '成员' ? 'gray' : 'gold'}">${esc(m.role)}</span></span>
        </button>`).join('')}</div>`, `<small>点击成员查看战绩</small>`),
    ].join('')
  }

  async function view2025() {
    const d = await load('y2025', () => api('/player/2025total', { ...who() }))
    const b = d.basic || {}
    const e = d.economy || {}
    if (!b.reg_date && !b.latest_battle && !d.combat) return emptyBox('没有找到 2025 年度数据')
    const sum = (group, keys) => {
      const t = Object.fromEntries(keys.map(k => [k, 0]))
      for (const m of Object.values(group || {})) for (const k of keys) t[k] += num(m[k])
      return t
    }
    const bw = sum(d.combat?.bedwars, ['game', 'win', 'kills', 'final_kills', 'bed_destory'])
    const sw = sum(d.combat?.skywars, ['game', 'win', 'kills'])
    const fav = b.favorite_type?.gameType
    return [
      card('<span class="eyebrow">2025</span> 我的布吉岛年度', `<div class="stats">
        ${stat('注册日期', date(b.reg_date))}
        ${stat('最后对局', esc(b.latest_battle || '-'))}
        ${fav ? stat('最爱模式', `${esc(LOG_TYPES[fav] || fav)}<br><small style="color:var(--muted);font-weight:700">${fmt(b.favorite_type.count)} 局</small>`, 'hl') : ''}
        ${b.favorite_time ? stat('活跃时段', `${esc(b.favorite_time.timePeriod)}`, 'good') : ''}
        ${stat('好友数', fmt((d.social?.friends || []).length))}
      </div>`),
      card('<span class="eyebrow">ECONOMY</span> 资产', `<div class="stats">
        ${stat('布吉岛经验', fmt(e.bjdxp), 'hl')}${stat('起床币', fmt(e.bwcoin))}${stat('空岛币', fmt(e.swcoin))}${stat('街机币', fmt(e.arcacoin))}
      </div>`),
      card('<span class="eyebrow">COMBAT</span> 年度战斗', `<div class="stats">
        ${stat('起床场次', fmt(bw.game))}${stat('起床胜场', fmt(bw.win), 'good')}${stat('起床终杀', fmt(bw.final_kills), 'hl')}
        ${stat('拆床', fmt(bw.bed_destory))}${stat('空岛场次', fmt(sw.game))}${stat('空岛击杀', fmt(sw.kills), 'hl')}
      </div>`),
    ].join('')
  }

  // ---------------------------------------------------------------- 弹窗内容
  const MATCH_COLS = [
    ['kill', '击杀'], ['final_kill', '终杀'], ['death', '死亡'], ['bed_destory', '拆床'],
    ['damage', '伤害'], ['hits', '命中'], ['longest_combo', '最高连击'], ['place', '放置'],
  ]

  async function showMatch(id, dateStr, type) {
    const title = `对局详情 · ${LOG_TYPES[type] || type}`
    openModal(title, loading())
    try {
      const m = await load('match:' + id, () => api('/gamelog/match', { match: id, date: dateStr }))
      if (!modalOpenFor(title)) return
      const teams = Object.entries(m.teams || {})
      teams.sort((a, b) => (b[0] === m.win) - (a[0] === m.win))
      const players = teams.flatMap(([, ps]) => ps)
      const cols = MATCH_COLS.filter(([k]) => players.some(p => p[k] != null))
      const head = `<div class="stats match-stats">
        ${stat('地图', esc(m.map || '-'))}
        ${stat('模式', esc([LOG_TYPES[m.gamemode] || m.gamemode, m.mode, m.kit].filter(Boolean).join(' · ')))}
        ${stat('开始', esc(dateTime(m.start_time)))}
        ${m.end_time ? stat('时长', esc(duration(m.start_time, m.end_time))) : ''}
        ${m.win ? stat('胜方', esc(m.win), 'good') : ''}
      </div>`
      const tables = teams.map(([team, ps]) => `
        <div class="team">
          <div class="team-head"><span>${esc(team)}</span>${team === m.win ? '<span class="tag">胜利</span>' : ''}</div>
          <div class="table-wrap"><table>
            <thead><tr><th>玩家</th>${cols.map(([, l]) => `<th>${l}</th>`).join('')}</tr></thead>
            <tbody>${ps.map(p => `<tr class="${p.player_uuid === state.uuid ? 'me' : ''}">
              <td><button class="namebtn" type="button" data-action="search" data-name="${esc(p.player_name)}">${esc(p.player_name)}</button></td>
              ${cols.map(([k]) => `<td>${p[k] != null ? fmt(p[k]) : '-'}</td>`).join('')}
            </tr>`).join('')}</tbody>
          </table></div>
        </div>`).join('')
      $('#modal-body').innerHTML = head + tables
    } catch (e) {
      if (modalOpenFor(title)) $('#modal-body').innerHTML = errorBox(e)
    }
  }

  async function showBoard(type, label) {
    openModal(label, loading())
    try {
      const d = await load('board:' + type, () => api('/leaderboard', { lb_type: type }))
      if (!modalOpenFor(label)) return
      const list = d.result || []
      $('#modal-body').innerHTML = list.length ? `<div class="list">${list.map(r => `
        <button class="row" type="button" data-action="search" data-name="${esc(r.name)}" ${r.name === state.name ? 'style="background:#2f4a26"' : ''}>
          <span class="top ${topCls(r.top)}">#${fmt(r.top)}</span>
          <span class="row-main"><span class="row-title">${esc(r.name)}</span></span>
          <span class="row-side">${fmt(r.score)}</span>
        </button>`).join('')}</div>` : emptyBox('榜单暂无数据')
    } catch (e) {
      if (modalOpenFor(label)) $('#modal-body').innerHTML = errorBox(e)
    }
  }

  const sharePath = () => `index.html?u=${encodeURIComponent(state.name)}`

  async function showQr() {
    const title = '扫码在手机上查看'
    openModal(title, loading('生成二维码…'))
    try {
      const { base64 } = await toy.getQrCode({ path: sharePath(), size: 320 })
      if (modalOpenFor(title)) {
        $('#modal-body').innerHTML = `<img class="qr" src="${esc(base64)}" alt="二维码"><p style="text-align:center;color:var(--muted);margin:0">用 B站 App 扫码，查看 ${esc(state.name)} 的战绩</p>`
      }
    } catch (e) {
      if (modalOpenFor(title)) $('#modal-body').innerHTML = errorBox(new Error('二维码生成失败'))
    }
  }

  // ---------------------------------------------------------------- 事件
  $('#search').addEventListener('submit', ev => { ev.preventDefault(); search($('#q').value) })

  document.addEventListener('click', async ev => {
    const el = ev.target.closest('[data-action]')
    if (!el || el.disabled) return
    const a = el.dataset.action
    if (a === 'check-follow') checkFollow()
    else if (a === 'start-using') startUsing()
    else if (a === 'recheck-tier') refreshTier()
    else if (a === 'search') search(el.dataset.name)
    else if (a === 'tab') selectTab(el.dataset.tab)
    else if (a === 'retry-tab') selectTab(state.tab)
    else if (a === 'other') { state.other = el.dataset.game; selectTab('other') }
    else if (a === 'page') { state.logPage = Number(el.dataset.page); selectTab('gamelog') }
    else if (a === 'match') showMatch(el.dataset.id, el.dataset.date, el.dataset.type)
    else if (a === 'board') showBoard(el.dataset.type, el.dataset.label)
    else if (a === 'close-modal') closeModal()
    else if (a === 'bind') setMine(state.name)
    else if (a === 'qr') showQr()
    else if (a === 'share') {
      try { await toy.share({ path: sharePath() }) } catch { toast('分享失败，请稍后再试') }
    }
    else if (a === 'copy-repo') copyText(el.dataset.url)
  })

  // WebView 里 navigator.clipboard 可能不可用或被拒，回退到 execCommand
  async function copyText(text) {
    let ok = false
    try {
      await navigator.clipboard.writeText(text)
      ok = true
    } catch {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.setAttribute('readonly', '')
      ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0'
      document.body.appendChild(ta)
      ta.select()
      ta.setSelectionRange(0, text.length)
      try { ok = document.execCommand('copy') } catch {}
      ta.remove()
    }
    toast(ok ? '已复制开源地址' : `复制失败，请手动复制：${text}`)
  }

  document.addEventListener('keydown', ev => { if (ev.key === 'Escape') closeModal() })

  // ---------------------------------------------------------------- 容器适配（B站 App）
  async function setupContainer() {
    if (!(await supports('getContainerState'))) return
    const root = document.documentElement.style
    const apply = s => {
      root.setProperty('--safe-top', (s.safeArea?.top || 0) + 'px')
      root.setProperty('--safe-bottom', (s.safeArea?.bottom || 0) + 'px')
    }
    // 右上角胶囊按钮不计入 safeArea，标题区右侧留白
    root.setProperty('--capsule', '84px')
    try { apply(await toy.getContainerState()) } catch {}
    if (await supports('onContainerChange')) {
      try { toy.onContainerChange(apply) } catch {}
    }
  }

  // ---------------------------------------------------------------- 关注与查询额度
  let checkingFollow = false
  let followCheckedAt = -Infinity
  let profileSupported = false
  let starting = false
  let checkingTier = false
  let tierCheckedAt = -Infinity
  let quotaTimer
  const missTimes = []

  function renderGate(title, message, { action, author, busy = false, error = false } = {}) {
    const gate = $('#gate')
    gate.classList.toggle('error', error)
    gate.innerHTML = `${busy ? '<div class="loader" aria-hidden="true"></div>' : ''}
      <h2 id="gate-title">${esc(title)}</h2>
      ${author?.nickname ? `<div class="gate-author">
        ${author.avatar ? `<img class="avatar" src="${esc(author.avatar)}" alt="">` : ''}<strong>${esc(author.nickname)}</strong>
      </div>` : ''}
      <p>${esc(message)}</p>
      ${action ? `<button class="btn btn-primary" type="button" data-action="${action[0]}">${esc(action[1])}</button>` : ''}`
  }

  async function checkFollow(minInterval = 0) {
    if (unlocked || starting || checkingFollow || performance.now() - followCheckedAt < minInterval) return
    checkingFollow = true
    followCheckedAt = performance.now()
    renderGate('正在检测关注状态', '查询战绩前需要关注本 Toy 的作者。', { busy: true })
    const unsupported = () => renderGate('请在哔哩哔哩 App 打开', '当前环境不支持检测关注状态，请在哔哩哔哩 App 内重新打开本 Toy。')
    try {
      if (!(await supports('getAuthorRelation'))) {
        unsupported()
        return
      }
      const result = await toy.getAuthorRelation()
      if (result?.status === 'unsupported') {
        unsupported()
      } else if (result?.status === 'unauthorized') {
        renderGate('请先登录', '请在哔哩哔哩 App 登录账号，再返回本 Toy。')
      } else if (result?.status === 'ok' && result.data?.isFollowing === true) {
        // 在展示按钮前检查支持情况，点击时直接发起授权调用。
        profileSupported = await supports('getUserProfile')
        renderGate('已关注作者', '点击下方按钮开始查询布吉岛战绩。', { action: ['start-using', '开始使用'] })
      } else if (result?.status === 'ok' && result.data?.isFollowing === false) {
        let author
        if (await supports('getAuthorProfile')) {
          try {
            const profile = await toy.getAuthorProfile()
            if (profile?.status === 'ok') author = profile.data
          } catch { /* 作者资料不影响关注提示 */ }
        }
        renderGate('请先关注本 Toy 的作者', '关注后返回本页面，即可查询布吉岛战绩。', {
          action: ['check-follow', '我已关注，重新检测'], author,
        })
      } else {
        throw new Error()
      }
    } catch {
      renderGate('暂时无法检测关注状态', '请稍后重试。', { action: ['check-follow', '重试'], error: true })
    } finally {
      checkingFollow = false
    }
  }

  async function startUsing() {
    if (unlocked || starting || checkingFollow) return
    starting = true
    renderGate('已关注作者', '正在启动查询…', { busy: true })
    if (profileSupported) {
      try {
        const profile = await toy.getUserProfile()
        if (typeof profile?.toyOpenId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(profile.toyOpenId)) {
          toyOpenId = profile.toyOpenId
        }
      } catch { /* 未授权时仍可按基础额度查询 */ }
    }
    unlock()
    refreshTier()
  }

  function unlock() {
    unlocked = true
    $('#gate').hidden = true
    $('#search').hidden = $('#quota').hidden = $('#empty').hidden = false
    renderQuota()
    renderQuick()
    syncMineFromCloud()
    const initial = params.get('u')
    if (initial) search(initial)
  }

  function updateRemaining() {
    const now = performance.now()
    while (missTimes.length && missTimes[0] <= now - MINUTE) missTimes.shift()
    const remaining = Math.max(0, effectiveQuota() - missTimes.length)
    $('#quota-remaining').textContent = `本页面近 60 秒预计剩余 ${remaining} 次`
    clearTimeout(quotaTimer)
    if (missTimes.length) quotaTimer = setTimeout(updateRemaining, missTimes[0] + MINUTE - now + 1)
  }

  function renderQuota() {
    const label = $('#quota-tier')
    if (effectiveQuota() === 20) label.textContent = '已三连：每分钟 20 次'
    else if (tier === 'triple') label.textContent = '已三连：未取得用户标识，每分钟 10 次'
    else label.textContent = `每分钟 10 次（${TRIPLE_HINT}）`
    const recheck = $('#quota-recheck')
    recheck.hidden = localPreview || tier === 'triple'
    recheck.disabled = checkingTier
    recheck.textContent = checkingTier ? '正在检测三连…' : '我已三连，重新检测'
    updateRemaining()
  }

  async function refreshTier(minInterval = 0) {
    if (localPreview || !unlocked || tier === 'triple' || checkingTier || performance.now() - tierCheckedAt < minInterval) return
    checkingTier = true
    tierCheckedAt = performance.now()
    renderQuota()
    try {
      if (!(await supports('getAuthorVideoRange')) || !(await supports('getVideoUserActions'))) return
      const end = Math.floor(Date.now() / 1000)
      const seen = new Set()
      let start = end - 365 * 86_400
      for (;;) {
        const page = await toy.getAuthorVideoRange({ start, end })
        if (!page.items.length) return
        const aids = []
        for (const { aid, bvid } of page.items) {
          if (seen.has(bvid)) continue
          seen.add(bvid)
          aids.push(aid)
        }
        for (let i = 0; i < aids.length; i += 50) {
          const actions = await toy.getVideoUserActions({ aids: aids.slice(i, i + 50) })
          if (actions.status !== undefined && actions.status !== 'ok') return
          if (actions.items.some(v => v.status === 'ok' && v.liked && v.coinCount > 0 && v.favorited)) {
            tier = 'triple'
            return
          }
        }
        const next = page.items[page.items.length - 1].publishTime
        if (!page.hasMore || next < start || (next === start && !aids.length)) return
        start = next
      }
    } catch { /* 无法确认三连时保留基础额度 */ }
    finally {
      checkingTier = false
      renderQuota()
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return
    if (unlocked) refreshTier(30_000)
    else checkFollow(5_000)
  })

  // ---------------------------------------------------------------- 启动
  setupContainer()
  if (localPreview) {
    toyOpenId = 'local-dev'
    if (params.get('tier') === 'triple') tier = 'triple'
    unlock()
    toast('本地预览：已跳过关注检测')
  } else {
    checkFollow()
  }
})()
