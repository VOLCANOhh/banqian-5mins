const api = require('../../utils/api')

// 界面一 · 推送记录（主界面）：记录每次推送的人员/日期/内容
// 圆角卡片竖排、按日期分组隔开、顶部检索、底部「添加今日推送」
Page({
  data: {
    keyword: '',
    records: [],
    grouped: [],      // [{ date, label, items: [] }]
    detailRec: null   // 点卡片看详情（半屏）
  },

  onShow() {
    this.load()
  },

  load() {
    api.tasksList()
      .then(r => {
        this.records = r.items
        this.applyFilter(this.data.keyword)
      })
      .catch(() => wx.showToast({ title: '记录加载失败', icon: 'none' }))
  },

  onPullDownRefresh() {
    this.load()
    wx.stopPullDownRefresh()
  },

  /* ---------- 检索：内容标题 / 对象 / 备注 ---------- */
  onKeyword(e) {
    const k = e.detail.value.trim()
    this.setData({ keyword: k })
    this.applyFilter(k)
  },

  applyFilter(k) {
    const items = k
      ? this.records.filter(r =>
          r.task_text.includes(k) ||
          r.target_desc.includes(k) ||
          (r.note || '').includes(k) ||
          r.date.includes(k))
      : this.records
    this.setData({ grouped: this.groupByDate(items) })
  },

  groupByDate(items) {
    const t = this.dateStr(0)
    const y = this.dateStr(-1)
    const map = new Map()
    items.forEach(r => {
      if (!map.has(r.date)) map.set(r.date, [])
      map.get(r.date).push(r)
    })
    return [...map.entries()].map(([date, list]) => ({
      date,
      label: date === t ? `今天 ${date.slice(5)}` : date === y ? `昨天 ${date.slice(5)}` : date,
      items: list
    }))
  },

  dateStr(off) {
    const d = new Date(Date.now() + off * 86400000)
    const p = n => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
  },

  /* ---------- 记录详情 ---------- */
  openRec(e) {
    this.setData({ detailRec: e.currentTarget.dataset.item })
  },
  closeRec() {
    this.setData({ detailRec: null })
  },

  /* ---------- 添加今日推送 ---------- */
  goAdd() {
    wx.navigateTo({ url: '/pages/admin/pushEdit' })
  }
})
