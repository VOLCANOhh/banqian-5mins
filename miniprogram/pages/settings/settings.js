const config = require('../../config')

// 设置页：应用信息（版本号等）+ 客服与反馈 + 隐私声明。纯展示页，无后端依赖。
// 【发版记得维护 INFO】版本号手动 +1；客服电话/微信/邮箱换项目负责人的真实联系方式
const INFO = {
  version: '1.0.0',                     // 前端版本（手动维护）
  build: '2026-10-06 ',          // 构建说明
  phone: '000-0000-0000',               // 客服电话（占位；真实联系方式见提交材料）
  wechat: 'contact-admin',              // 客服微信（占位；真实联系方式见提交材料）
  email: 'banqian@example.com'          // 反馈邮箱（占位；真实联系方式见提交材料）
}

Page({
  data: {
    info: INFO,
    env: { ver: '—', mpVer: '—', sdk: '—' },
    apiBase: config.API_BASE,
    mock: config.USE_MOCK
  },

  onLoad() {
    // 运行环境：开发版/体验版/正式版 + 小程序版本 + 基础库版本（真机/工具自动识别，无需维护）
    try {
      const acc = wx.getAccountInfoSync()
      const sys = wx.getSystemInfoSync()
      const envMap = { develop: '开发版', trial: '体验版', release: '正式版' }
      this.setData({
        env: {
          ver: envMap[acc.miniProgram.envVersion] || acc.miniProgram.envVersion || '—',
          mpVer: acc.miniProgram.version || '—',
          sdk: sys.SDKVersion || '—'
        }
      })
    } catch (e) {}
  },

  // 客服电话：一键拨打
  call() {
    wx.makePhoneCall({ phoneNumber: this.data.info.phone, fail: () => {} })
  },

  // 客服微信/邮箱：一键复制
  copy(e) {
    wx.setClipboardData({
      data: e.currentTarget.dataset.v,
      success: () => wx.showToast({ title: '已复制', icon: 'none' })
    })
  }
})
