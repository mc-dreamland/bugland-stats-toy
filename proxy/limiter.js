// SPDX-License-Identifier: AGPL-3.0-only
// 进程内滑动窗口限流器，接口与 Cloudflare Rate Limiting 绑定一致：limit({ key }) → { success }
// 用于自建 Node 部署（proxy/node-server.mjs）和本地预览（dev-server.mjs）；单进程有效，重启清零
export function slidingWindowLimiter(max, windowMs) {
  const timestamps = new Map()
  let nextCleanup = 0
  return {
    async limit({ key }) {
      const now = performance.now()
      const cutoff = now - windowMs
      if (now >= nextCleanup) {
        for (const [storedKey, hits] of timestamps) {
          if (hits[hits.length - 1] <= cutoff) timestamps.delete(storedKey)
        }
        nextCleanup = now + windowMs
      }
      let hits = timestamps.get(key)
      if (!hits) {
        hits = []
        timestamps.set(key, hits)
      }
      while (hits.length && hits[0] <= cutoff) hits.shift()
      if (hits.length >= max) return { success: false }
      hits.push(now)
      return { success: true }
    },
  }
}
