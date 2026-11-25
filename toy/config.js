// SPDX-License-Identifier: AGPL-3.0-only
// 部署者唯一需要修改的前端配置：代理地址。
// 本地预览保持 '/v2'（dev-server.mjs 同源代理）；发布到 B站前改成你自己部署的代理，必须是 HTTPS，例如 'https://api.example.com/v2'
window.BJD_TOY_CONFIG = {
  apiBase: '/v2',
}
