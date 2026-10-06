const api = require('../../utils/api')

// 界面二 · 学习情况：姓名检索 + 今天/往期看板 + 点工人卡片进详情页
// 协议全文见 miniprogram/PROTOCOL.md §9；UI 规范见 docs/ui-references.md
const JOB_CLS = {
  '架子工': 'tag-j1', '钢筋工': 'tag-j2', '混凝土工': 'tag-j3',
  '木工': 'tag-j4', '电工': 'tag-j5', '塔吊司机': 'tag-j6', '其他': 'tag-j7'
}
const withCls = w => ({ ...w, _cls: JOB_CLS[w.job] || 'tag-j7' })

Page({
  data: {
    tab: 'today',        // today | history
    keyword: '',         // 姓名检索
    searchResults: [],   // 检索结果（含今日状态）
    allWorkers: [],      // 检索池（脱敏）
    overview: null,
    pendingList: [],
    doneList: [],
    err: '',
    showRemind: false,
    reminding: false,
    // 往期
    historyDays: [],
    historyKeyword: '',      // 往期日期检索（如 "09-2"）
    filteredHistoryDays: [],
    historyDate: '',     // '' = 显示日期列表；有值 = 显示那天看板
    hpList: [],
    hdList: []
  },

  onShow() {
    this.load()
    this.loadWorkers()
  },

  loadWorkers() {
    api.getWorkers()
      .then(r => this.setData({ allWorkers: r.workers.map(withCls) }))
      .catch(() => {})
  },

  load() {
    this.setData({ err: '' })
    api.adminOverview()
      .then(o => {
        const list = o.workers.map(withCls)
        this.setData({
          overview: { ...o, workers: list },
          pendingList: list.filter(w => w.status === 'pending'),
          doneList: list.filter(w => w.status === 'done'),
          err: ''
        })
        if (this.data.keyword) this.applySearch(this.data.keyword)
      })
      .catch(() => this.setData({ err: '看板加载失败，请检查网络后重试' }))
  },

  onPullDownRefresh() {
    this.load()
    if (this.data.tab === 'history' && !this.data.historyDate) this.loadHistory()
    wx.stopPullDownRefresh()
  },

  /* ---------- 姓名检索 ---------- */
  onSearchInput(e) {
    const keyword = e.detail.value.trim()
    this.setData({ keyword })
    this.applySearch(keyword)
  },

  applySearch(keyword) {
    if (!keyword) {
      this.setData({ searchResults: [] })
      return
    }
    const statusMap = {}
    ;(this.data.overview ? this.data.overview.workers : []).forEach(w => { statusMap[w.worker_id] = w })
    const searchResults = this.data.allWorkers
      .filter(w => w.name.includes(keyword))
      .map(w => ({ ...w, today: statusMap[w.worker_id] || null }))
    this.setData({ searchResults })
  },

  clearSearch() {
    this.setData({ keyword: '', searchResults: [] })
  },

  /* ---------- 今天 / 往期 ---------- */
  switchTab(e) {
    const tab = e.currentTarget.dataset.tab
    if (tab === this.data.tab) return
    this.setData({ tab })
    if (tab === 'history' && !this.data.historyDays.length) this.loadHistory()
  },

  loadHistory() {
    api.adminHistory()
      .then(r => this.setData({ historyDays: r.days, filteredHistoryDays: r.days }))
      .catch(() => wx.showToast({ title: '往期加载失败', icon: 'none' }))
  },

  // 往期日期检索：按日期串模糊匹配（如 "09-2"、"25"）
  onHistoryInput(e) {
    const k = e.detail.value.trim()
    this.setData({
      historyKeyword: k,
      filteredHistoryDays: k
        ? this.data.historyDays.filter(d => d.date.includes(k))
        : this.data.historyDays
    })
  },

  pickDay(e) {
    const date = e.currentTarget.dataset.date
    this.setData({ historyDate: date })
    api.adminOverview(date)
      .then(o => {
        const list = o.workers.map(withCls)
        this.setData({
          hpList: list.filter(w => w.status === 'pending'),
          hdList: list.filter(w => w.status === 'done')
        })
      })
      .catch(() => wx.showToast({ title: '加载失败', icon: 'none' }))
  },

  backToDays() {
    this.setData({ historyDate: '', hpList: [], hdList: [] })
  },

  /* ---------- 跳详情 ---------- */
  goDetail(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: '/pages/admin/workerDetail?id=' + id })
  },

  /* ---------- 一键提醒 ---------- */
  openRemind() {
    this.setData({ showRemind: true })
  },
  closeRemind() {
    this.setData({ showRemind: false, reminding: false })
  },
  sendRemind() {
    if (this.data.reminding) return
    this.setData({ reminding: true })
    api.adminRemind(this.data.pendingList.map(w => w.worker_id))
      .then(r => {
        this.setData({ showRemind: false, reminding: false })
        wx.showToast({ title: `已提醒 ${r.reminded} 人`, icon: 'success' })
      })
      .catch(() => {
        this.setData({ reminding: false })
        wx.showToast({ title: '提醒失败，请重试', icon: 'none' })
      })
  }
})
