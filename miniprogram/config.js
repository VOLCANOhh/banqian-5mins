module.exports = {
  // 后端编排器地址：
  //   本机联调   → http://10.27.209.220:3000（开发者工具勾"不校验合法域名"）
  //   云服务器部署后 → https://api.maomaozhao.cn
  API_BASE: 'https://api.maomaozhao.cn',

  // 后端未就绪前用假数据跑页面；联调时改 false
  USE_MOCK: false,

  // Mock 角色开关：'worker' 工人端（默认）| 'admin' 管理员端（演示看板/推送/工人管理）
  // 真机无此开关——角色由后端 /api/me 按 openid 判定
  MOCK_ROLE: 'admin',

  MOCK_DELAY: 300
}
