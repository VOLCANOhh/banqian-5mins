App({
  globalData: {
    me: null,        // /api/me 结果：{ openid, role, worker?, need_bind? }
    worker: null,    // 当前工友档案
    sessionId: null, // 本次学习会话
    volume: 1,       // 语音指令"大点声/小点声"调这里，接 TTS 后生效
    launchCode: ''   // wx.login 的 code（AppSecret 就位后后端 jscode2session 换 openid）
  },
  onLaunch() {
    // 静默登录：wx.login 只换 code，不弹授权框——工人端"手机 id 即可"靠它
    // AppSecret 未配置期间，后端用 api.js 的 dev_id（本机持久随机串）当 openid 占位
    this.loginP = new Promise(resolve => {
      wx.login({
        success: r => { this.globalData.launchCode = r.code; resolve(r.code) },
        fail: () => resolve('')
      })
    })
  }
})
