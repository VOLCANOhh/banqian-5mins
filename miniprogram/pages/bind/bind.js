const api = require('../../utils/api')
const drawQrcode = require('../../utils/qrcode')
const app = getApp()

// 身份绑定页：扫门口码进来但没有档案时停在这里
// 机制1：亮出本机身份码 → 班组长 app 内"扫一扫"认领
// 机制2：扫班组长发的绑定码 → 原地自绑
Page({
  data: {
    tip: '',
    scanning: false
  },

  onLoad() {
    this.refresh()
    // 轮询：管理员一完成认领，这里自动进入学习（工人全程不点任何东西）
    this.poll = setInterval(() => this.refresh(), 4000)
  },

  onUnload() {
    clearInterval(this.poll)
  },

  refresh() {
    api.bindTicket()
      .then(r => {
        if (r.bound) return this.enter(r.worker)
        if (r.ticket !== this.ticket) {
          this.ticket = r.ticket
          drawQrcode({ canvasId: 'qrc', _this: this, text: r.qr_text, width: 280, height: 280 })
        }
      })
      .catch(() => this.setData({ tip: '网络不通，请检查网络后重新进入' }))
  },

  // 机制2：扫班组长发的绑定码（文本码/小程序码都行，wx.scanCode 全能识别）
  scanBind() {
    if (this.data.scanning) return
    this.setData({ scanning: true })
    wx.scanCode({
      onlyFromCamera: true,
      success: r => this.resolveCode(r.result),
      fail: () => this.setData({ scanning: false, tip: '没扫到，请对准二维码再试' }),
      complete: () => this.setData({ scanning: false })
    })
  },

  resolveCode(raw) {
    api.bindResolve(raw)
      .then(r => this.enter(r.worker))
      .catch(e => this.setData({ tip: (e && e.error) || '绑定码无效或已过期' }))
  },

  // 班组长误扫门口码 → 去激活页输口令（激活后 openid 进白名单，之后自动分流）
  goAdmin() {
    wx.navigateTo({ url: '/pages/admin/login' })
  },

  enter(worker) {
    clearInterval(this.poll)
    app.globalData.worker = worker
    wx.showToast({ title: `已绑定：${worker.name}`, icon: 'success' })
    // 绑定完成 = 进入学习流：按门口码语义（r=gate）跳进 training——
    // 双重身份设备（管理员+工人）才不会被"无场景直接打开"默认分流到管理端
    setTimeout(() => wx.reLaunch({ url: '/pages/training/training?scene=' + encodeURIComponent('r=gate') }), 800)
  }
})
