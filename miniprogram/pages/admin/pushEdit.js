const api = require('../../utils/api')
const voice = require('../../utils/voice')
const config = require('../../config')

// 添加今日推送：一、先选人（全部/分组/个人）→ 二、说/填今日工作（语音输入 + 历史联想 +
// 近两天推送一键沿用；规范由系统按工序自动匹配，管理员不选预制内容、不选条文）→ 三、备注 → 推送
//
// HANDOFF §1.7：管理员只做两件事——①今天干什么活 ②谁是我的人。本页就是①的落地。

// 历史工作去重：同一 task_text 只留最近一次（规范沿用那次的 kb_ids），记录本身新→旧
function dedupeHistory(items) {
  const map = new Map()
  for (const r of items || []) {
    if (!r.task_text) continue
    if (map.has(r.task_text)) map.get(r.task_text).times++
    else map.set(r.task_text, { task_text: r.task_text, kb_ids: r.kb_ids || [], date: r.date, times: 1 })
  }
  return [...map.values()]
}

// 输入联想：历史工作包含已输入文字即候选（已输全的不再提示），短句优先——更像"输到一半点它"
function matchHistory(history, kw) {
  const k = String(kw || '').trim()
  if (!k) return []
  return history
    .filter(h => h.task_text.includes(k) && h.task_text !== k)
    .sort((a, b) => a.task_text.length - b.task_text.length)
    .slice(0, 5)
}

function dateStr(off) {
  const d = new Date(Date.now() + off * 86400000)
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

Page({
  data: {
    note: '',
    pushing: false,
    pushedCount: 0,

    /* 〇、工作环境天气（自动定位获取，随推送上送 → ①工序解析环境输入） */
    weather: null,          // weather 对象 { temp, text, wind_dir, wind_scale, ..., risk_level, risk_hints[] }
    weatherGeo: null,       // { lat, lng }（wgs84）
    weatherLoading: false,
    weatherErr: '',

    /* 一、推送对象（先选） */
    targetType: 'all',      // all | group | worker
    groups: [],
    targetGroup: null,
    targetWorker: null,
    showWorkerPick: false,
    workerKeyword: '',
    allWorkers: [],
    filteredWorkers: [],

    /* 二、今日工作（语音/文字输入 + 历史联想 + 近两天推送） */
    taskText: '',           // 今日工作：管理员自己说/填，不选预制内容
    history: [],            // 去重后的历史工作 [{task_text, kb_ids, date, times}]
    historyMatch: [],       // 输入中联想出的历史工作（≤5）
    recentItems: [],        // 近两天推送（今天+昨天，去重；点一下沿用工作内容+规范）
    carriedKbIds: null,     // 点了历史联想/近两天推送带过来的规范（文字再改就作废，推送时重新检索）
    voiceState: '',         // '' | 'recording' | 'recognizing'
    customDetail: null      // 规范预览半屏 { title, kb, loading }
  },

  onLoad() {
    this.loadWeather(false)
    api.getGroups().then(r => this.setData({ groups: r.groups })).catch(() => {})
    api.getWorkers().then(r => this.setData({ allWorkers: r.workers, filteredWorkers: r.workers })).catch(() => {})
    api.tasksList()
      .then(r => {
        const history = dedupeHistory(r.items)
        const t = dateStr(0), y = dateStr(-1)
        const recentItems = history
          .filter(h => h.date === t || h.date === y)
          .map(h => ({ ...h, dateLabel: h.date === t ? '今天' : '昨天' }))
        this.setData({ history, recentItems })
      })
      .catch(() => {})

    // 「为他推送巩固内容」预填（来自工人详情页）→ 直接填进今日工作输入框
    const pre = wx.getStorageSync('push_prefill')
    if (pre) {
      wx.removeStorageSync('push_prefill')
      const patch = { taskText: pre.task_text || '', note: pre.note || '' }
      if (pre.target && pre.target.startsWith('worker:')) {
        const w = this.data.allWorkers.find(x => x.worker_id === pre.target.slice(7))
        if (w) { patch.targetType = 'worker'; patch.targetWorker = w }
      }
      this.setData(patch)
    }
  },

  onUnload() {
    this._dead = true
    if (this.data.voiceState === 'recording') voice.stop()
  },

  /* ================= 一、推送对象 ================= */
  pickAll() {
    this.setData({ targetType: 'all', targetGroup: null, targetWorker: null })
  },
  pickGroup(e) {
    const g = e.currentTarget.dataset.g
    this.setData({ targetType: 'group', targetGroup: g, targetWorker: null })
  },
  openWorkerPick() {
    this.setData({ showWorkerPick: true, workerKeyword: '', filteredWorkers: this.data.allWorkers })
  },
  closeWorkerPick() {
    this.setData({ showWorkerPick: false })
  },
  onWorkerKeyword(e) {
    const k = e.detail.value.trim()
    this.setData({
      workerKeyword: k,
      filteredWorkers: k ? this.data.allWorkers.filter(w => w.name.includes(k)) : this.data.allWorkers
    })
  },
  pickWorker(e) {
    const w = e.currentTarget.dataset.w
    this.setData({ targetType: 'worker', targetWorker: w, showWorkerPick: false, targetGroup: null })
  },

  /* ================= 二、今日工作（输入 + 历史联想） ================= */
  onTaskInput(e) {
    const t = e.detail.value
    this.setData({
      taskText: t,
      // 文字和上次点选的联想/推荐不一致 → 带过来的规范作废，推送时重新检索
      carriedKbIds: t === this._pickedText ? this.data.carriedKbIds : null,
      historyMatch: matchHistory(this.data.history, t)
    })
  },

  // 点联想 → 填入 + 沿用那次的规范（一模一样的工作不用重新检索）
  pickHistory(e) {
    const h = e.currentTarget.dataset.h
    this._pickedText = h.task_text
    this.setData({
      taskText: h.task_text,
      carriedKbIds: h.kb_ids && h.kb_ids.length ? h.kb_ids : null,
      historyMatch: []
    })
  },

  /* ---------- 语音输入：按住说话，松开出文字（识别复用 voice.js 答题通道；Key 只在后端） ---------- */
  voiceStart() {
    if (this.data.voiceState) return
    if (config.USE_MOCK) {
      // mock 不真录音：假装识别一下，给个库外泛化演示工序（对接 HANDOFF §7.1 验收场景）
      this.setData({ voiceState: 'recognizing' })
      setTimeout(() => {
        if (this._dead) return
        const t = '五层地下室顶板浇筑'
        this._pickedText = null
        this.setData({ voiceState: '', taskText: t, carriedKbIds: null, historyMatch: matchHistory(this.data.history, t) })
      }, 900)
      return
    }
    const ok = voice.start(text => {
      if (this._dead) return
      this.setData({ voiceState: '' })
      const t = String(text || '').trim().replace(/[。，！？\s]+$/, '')
      if (!t) { wx.showToast({ title: '没听清，再说一次', icon: 'none' }); return }
      // 已有文字 → 接在后面（管理员可能分两段说）
      const merged = this.data.taskText ? this.data.taskText + '，' + t : t
      this._pickedText = null
      this.setData({ taskText: merged, carriedKbIds: null, historyMatch: matchHistory(this.data.history, merged) })
    })
    if (ok) this.setData({ voiceState: 'recording' })
    else wx.showToast({ title: '录音被占用，稍后再试', icon: 'none' })
  },
  voiceStop() {
    if (this.data.voiceState !== 'recording') return
    this.setData({ voiceState: 'recognizing' })
    voice.stop()
  },

  /* ---------- 规范预览（可选）：推送前看看系统按这道工序匹配到什么规范（特征函数×RAG 坑位） ---------- */
  openPreview() {
    const title = this.data.taskText.trim()
    if (!title) return
    this.setData({ customDetail: { title, kb: [], loading: true } })
    api.kbSearch(title)
      .then(r => this.setData({ customDetail: { title, kb: r.items, loading: false } }))
      .catch(() => this.setData({ customDetail: { title, kb: [], loading: false } }))
  },
  closeDetail() {
    this.setData({ customDetail: null })
  },

  /* ================= 〇、工作环境天气 ================= */
  // 自动定位 → 服务端代理天气（和风，Key 只在后端）。fromTap=true 表示管理员点卡片重试，
  // 定位权限被拒过就带去设置页；失败不阻塞推送（env 留空，天气退回 task_text 人工描述）
  loadWeather(fromTap) {
    if (this.data.weatherLoading) return
    this.setData({ weatherLoading: true, weatherErr: '' })
    api.getWeather()
      .then(r => this.setData({ weather: r.weather, weatherGeo: { lat: r.lat, lng: r.lng }, weatherLoading: false }))
      .catch(err => {
        const denied = err && /deny|auth/i.test(String(err.errMsg || ''))
        this.setData({
          weatherLoading: false,
          weatherErr: denied ? '定位权限未开启，点我去开启' : '天气获取失败，点我重试'
        })
        if (denied && fromTap) wx.openSetting({})
      })
  },

  /* ================= 三、备注与推送 ================= */
  onInput(e) {
    this.setData({ [e.currentTarget.dataset.k]: e.detail.value })
  },

  submit() {
    if (this.data.pushing) return
    const taskText = this.data.taskText.trim()
    if (!taskText) {
      wx.showToast({ title: '先说说今天干什么活', icon: 'none' })
      return
    }
    let target = 'all'
    if (this.data.targetType === 'group' && this.data.targetGroup) target = 'group:' + this.data.targetGroup.group_id
    if (this.data.targetType === 'worker' && this.data.targetWorker) target = 'worker:' + this.data.targetWorker.worker_id
    this.setData({ pushing: true })
    const d = new Date()
    const p = n => String(n).padStart(2, '0')
    // 规范来源：点过历史联想/近两天推送带过来的直接用（同一工作沿用上次）；否则按工序文本现场检索
    const kbIdsP = this.data.carriedKbIds
      ? Promise.resolve(this.data.carriedKbIds)
      : api.kbSearch(taskText).then(r => (r.items || []).map(k => k.kb_id)).catch(() => [])
    kbIdsP
      .then(kb_ids => api.pushTask({
        date: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`,
        task_text: taskText,
        note: this.data.note.trim(),
        kb_ids,
        target,
        // 工作环境快照：{ lat, lng, weather }，服务端随 task 存档 → ①工序解析的环境输入
        env: this.data.weather ? { lat: this.data.weatherGeo.lat, lng: this.data.weatherGeo.lng, weather: this.data.weather } : undefined
      }))
      .then(r => {
        wx.vibrateShort({ type: 'light' })
        this.setData({ pushedCount: r.target_count || 0, pushing: false })
        setTimeout(() => wx.navigateBack(), 1100)   // 返回推送记录页
      })
      .catch(() => {
        this.setData({ pushing: false })
        wx.showToast({ title: '推送失败，请重试', icon: 'none' })
      })
  }
})
