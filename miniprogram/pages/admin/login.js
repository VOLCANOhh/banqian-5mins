const api = require('../../utils/api')

// 班组长登录页 = 微信登录页
// 进来就静默 wx.login：openid 在白名单 → 直接进管理端；不在 → 提示未授权
// 扫"班组长专用码"（?k=管理员码key）首次登记进白名单，之后任何入口微信登录直达
Page({
  data: { err: '', loading: true },

  onLoad(options) {
    if (options && options.k) this.enroll(options.k)
    else this.login()
  },

  // 扫码带 key → 本微信号登记为管理员（码即凭证）
  enroll(key) {
    wx.login({
      success: r =>
        api.adminActivate({ code: r.code, qr_key: key })
          .then(() => this.enter())
          .catch(e => this.fail((e && e.error) || '班组长码已失效，请联系项目负责人重发')),
      fail: () => this.fail('微信登录失败，请重试')
    })
  },

  // 纯微信登录：白名单内直接进管理端
  login() {
    this.setData({ err: '', loading: true })
    wx.login({
      success: r =>
        api.me({ code: r.code })
          .then(me => me.role === 'admin'
            ? this.enter()
            : this.fail('当前微信未开通管理员。请扫描"班组长专用码"完成首次登记'))
          .catch(() => this.fail('网络不通，请重试')),
      fail: () => this.fail('微信登录失败，请重试')
    })
  },

  enter() {
    wx.showToast({ title: '欢迎，班组长', icon: 'success' })
    setTimeout(() => wx.switchTab({ url: '/pages/admin/push' }), 500)
  },
  fail(err) { this.setData({ err, loading: false }) },
  back() { wx.reLaunch({ url: '/pages/training/training?scene=' + encodeURIComponent('r=gate') }) }   // 返回工人端：按门口码语义跳，双重身份不落管理端
})
