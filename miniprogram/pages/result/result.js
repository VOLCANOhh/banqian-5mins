const app = getApp()

// 成绩页：得分 + 需要巩固 + 下次复训 + 「今日已完成」印章（班前会"签字归档"的数字化隐喻）
Page({
  data: {
    r: { score: 0, wrong_items: [] },
    praise: '',
    review: null,    // { month, day }
    stampDate: ''    // 印章上的日期 MM.DD
  },

  onLoad() {
    const r = wx.getStorageSync('result') || { score: 0, wrong_items: [] }
    const s = r.score || 0
    const praise = s >= 90 ? '记得牢，真棒！' : s >= 70 ? '学得不错' : '明天再巩固'
    let review = null
    if (r.next_review_date) {
      const parts = String(r.next_review_date).split('-')
      if (parts.length === 3) review = { month: +parts[1], day: +parts[2] }
    }
    const d = new Date()
    const p = n => String(n).padStart(2, '0')
    this.setData({ r, praise, review, stampDate: `${p(d.getMonth() + 1)}.${p(d.getDate())}` })
    // TODO: "回告"——完成状态同步后端/管理员看板（finish 已落库的话这里只展示）
  },

  replay() {
    app.globalData.sessionId = null
    // 「再看一遍」= 再学一次：按门口码语义跳入，双重身份设备（管理员+工人）才不会落进管理端
    wx.reLaunch({ url: '/pages/training/training?scene=' + encodeURIComponent('r=gate') })
  }
})
