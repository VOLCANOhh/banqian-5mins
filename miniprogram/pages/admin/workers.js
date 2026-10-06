const api = require('../../utils/api')
const config = require('../../config')
const drawQrcode = require('../../utils/qrcode')

const JOBS = ['架子工', '钢筋工', '混凝土工', '木工', '电工', '塔吊司机', '其他']
// 习惯语言：后端按它选 ASR 方言模型（阿里一句话识别按方言分 appkey/模型）
const DIALECTS = ['普通话', '山东话', '四川话', '粤语', '河南话', '东北话', '其他']
const JOB_CLS = {
  '架子工': 'tag-j1', '钢筋工': 'tag-j2', '混凝土工': 'tag-j3',
  '木工': 'tag-j4', '电工': 'tag-j5', '塔吊司机': 'tag-j6', '其他': 'tag-j7'
}
const withCls = w => ({ ...w, _cls: JOB_CLS[w.job] || 'tag-j7' })

// 界面三 · 工人管理：分组管理 + 规范信息表单（医院小程序式：分区/校验/脱敏/隐私声明）
Page({
  data: {
    groups: [],        // [{group_id, name, count, workers:[]}]
    all: [],           // 扁平工人列表（认领选人用）
    expanded: '',      // 展开的分组 group_id
    // 添加分组
    showAddGroup: false,
    groupName: '',
    // 添加/编辑工人
    editing: null,     // 草稿；null=关闭
    bind: null,
    jobs: JOBS,
    jobIndex: 0,
    dialects: DIALECTS,
    dialectIndex: 0,
    phoneDisplay: '',  // 手机号 3-4-4 分段显示
    errors: {},        // 字段级错误提示 {name?, age?, phone?}
    // 机制1 认领：扫工人身份码 → 选人/新建
    claim: null,       // { ticket }
    claimSel: '',      // 选中的已有工人 worker_id
    claimNew: false,   // 走"新建工人"模式
    claimErrors: {},
    newWorker: { name: '', age: '', job: JOBS[0], group_id: '', dialect: '普通话' },
    newJobIndex: 0,
    newGroupIndex: 0,
    newDialectIndex: 0
  },

  onShow() {
    this.load()
  },

  load() {
    Promise.all([api.getGroups(), api.getWorkers()])
      .then(([g, w]) => {
        const workers = w.workers.map(withCls)
        this.setData({
          all: workers,
          groups: g.groups.map(gr => ({
            ...gr,
            workers: workers.filter(x => x.group_id === gr.group_id)
          }))
        })
      })
      .catch(() => wx.showToast({ title: '加载失败', icon: 'none' }))
  },

  toggleGroup(e) {
    const gid = e.currentTarget.dataset.gid
    this.setData({ expanded: this.data.expanded === gid ? '' : gid })
  },

  /* ---------- 添加分组 ---------- */
  openAddGroup() {
    this.setData({ showAddGroup: true, groupName: '' })
  },
  closeAddGroup() {
    this.setData({ showAddGroup: false, groupName: '' })
  },
  onGroupNameInput(e) {
    this.setData({ groupName: e.detail.value })
  },
  saveGroup() {
    const name = this.data.groupName.trim()
    if (!name) {
      wx.showToast({ title: '先填组名', icon: 'none' })
      return
    }
    api.saveGroup(name)
      .then(() => {
        wx.showToast({ title: '分组已添加', icon: 'success' })
        this.closeAddGroup()
        this.load()
      })
      .catch(() => wx.showToast({ title: '添加失败', icon: 'none' }))
  },

  /* ---------- 添加 / 编辑工人 ---------- */
  addInGroup(e) {
    const gid = e.currentTarget.dataset.gid
    this.setData({
      editing: { worker_id: '', name: '', age: '', years: '', job: JOBS[0], group_id: gid, phone: '', dialect: '普通话' },
      jobIndex: 0,
      dialectIndex: 0,
      phoneDisplay: '',
      errors: {},
      bind: null
    })
  },

  edit(e) {
    const w = e.currentTarget.dataset.w
    this.setData({
      editing: { worker_id: w.worker_id, name: w.name, age: w.age, years: w.years, job: w.job, group_id: w.group_id, phone: '', dialect: w.dialect || '普通话' },
      jobIndex: Math.max(0, JOBS.indexOf(w.job)),
      dialectIndex: Math.max(0, DIALECTS.indexOf(w.dialect || '普通话')),
      phoneDisplay: '',   // 编辑留空 = 不修改手机号
      errors: {},
      bind: null
    })
  },

  onInput(e) {
    const k = e.currentTarget.dataset.k
    this.setData({ ['editing.' + k]: e.detail.value, ['errors.' + k]: '' })
  },

  // 手机号：纯数字存储，3-4-4 分段显示（医院小程序式输入规范）
  onPhoneInput(e) {
    const raw = e.detail.value.replace(/\D/g, '').slice(0, 11)
    let disp = raw
    if (raw.length > 7) disp = raw.slice(0, 3) + ' ' + raw.slice(3, 7) + ' ' + raw.slice(7)
    else if (raw.length > 3) disp = raw.slice(0, 3) + ' ' + raw.slice(3)
    this.setData({ 'editing.phone': raw, phoneDisplay: disp, 'errors.phone': '' })
  },

  onJob(e) {
    const i = +e.detail.value
    this.setData({ jobIndex: i, 'editing.job': JOBS[i] })
  },

  onDialect(e) {
    const i = +e.detail.value
    this.setData({ dialectIndex: i, 'editing.dialect': DIALECTS[i] })
  },

  validate() {
    const w = this.data.editing
    const errors = {}
    if (!String(w.name).trim()) errors.name = '请填写姓名'
    const age = +w.age
    if (!w.age || age < 16 || age > 70) errors.age = '请填写真实年龄（16-70）'
    if (w.phone && !/^1\d{10}$/.test(w.phone)) errors.phone = '手机号应为 11 位数字'
    this.setData({ errors })
    return !Object.keys(errors).length
  },

  // 原生 canvas 不跟滚动、层级错乱（半屏里码会"钉"在屏幕上还显示不全）——
  // 画到屏外画布，立刻 canvasToTempFilePath 转成图片，用 <image> 显示就一切正常
  renderQr(text, size) {
    drawQrcode({ canvasId: 'bindQr', _this: this, text, width: size, height: size })
    setTimeout(() => {
      wx.canvasToTempFilePath({
        canvasId: 'bindQr', x: 0, y: 0, width: size, height: size,
        success: res => this.setData({ 'bind.qr_img': res.tempFilePath }),
        fail: () => {}   // 转图失败：屏外画布留着当兜底（码还在，只是不跟滚动）
      }, this)
    }, 500)
  },

  save() {
    if (!this.validate()) return
    const w = this.data.editing
    api.saveWorker({ ...w, age: +w.age || 0, years: +w.years || 0 })
      .then(r => {
        // 有 wxacode_url → 官方小程序码图（微信扫一扫直进）；否则降级文本码 → 画完转图片
        if (r.bind && r.bind.wxacode_url) r.bind.wxacode_img = config.API_BASE + r.bind.wxacode_url
        this.setData({ bind: r.bind, editing: { ...this.data.editing, worker_id: r.worker.worker_id } },
          () => r.bind && r.bind.qr_text && !r.bind.wxacode_img && this.renderQr(r.bind.qr_text, 150))
        this.load()
        wx.showToast({ title: '已保存', icon: 'success' })
      })
      .catch(() => wx.showToast({ title: '保存失败，请重试', icon: 'none' }))
  },

  cancel() {
    this.setData({ editing: null, bind: null, errors: {} })
  },

  /* ---------- 机制1：扫工人身份码 → 认领 ---------- */
  scanClaim() {
    wx.scanCode({
      onlyFromCamera: true,
      success: r => this.openClaim(r.result),
      fail: () => {}
    })
  },
  noop() {},   // 拦截 half-sheet 内部点击，别穿透到遮罩触发关闭

  openClaim(raw) {
    const t = (String(raw).match(/(\d{6})/) || [])[1]
    if (!t) return wx.showToast({ title: '不是身份码', icon: 'none' })
    this.setData({ claim: { ticket: t }, claimSel: '', claimNew: false, claimErrors: {} })
  },
  pickWorker(e) {
    this.setData({ claimSel: e.currentTarget.dataset.id, claimNew: false })
  },
  pickNew() {
    this.setData({ claimNew: true, claimSel: '', claimErrors: {}, newGroupIndex: 0, newDialectIndex: 0,
      newWorker: { name: '', age: '', job: JOBS[0], group_id: (this.data.groups[0] || {}).group_id || '', dialect: '普通话' } })
  },
  onNewInput(e) {
    const k = e.currentTarget.dataset.k
    this.setData({ ['newWorker.' + k]: e.detail.value, ['claimErrors.' + k]: '' })
  },
  onNewJob(e) {
    const i = +e.detail.value
    this.setData({ newJobIndex: i, 'newWorker.job': JOBS[i] })
  },
  onNewDialect(e) {
    const i = +e.detail.value
    this.setData({ newDialectIndex: i, 'newWorker.dialect': DIALECTS[i] })
  },
  onNewGroup(e) {
    const i = +e.detail.value
    const g = this.data.groups[i]
    if (g) this.setData({ newGroupIndex: i, 'newWorker.group_id': g.group_id, 'claimErrors.group_id': '' })
  },
  closeClaim() { this.setData({ claim: null }) },
  claimSubmit() {
    let payload
    if (this.data.claimNew) {
      const w = this.data.newWorker
      const errs = {}
      if (!String(w.name).trim()) errs.name = '请填姓名'
      const age = +w.age
      if (!w.age || age < 16 || age > 70) errs.age = '真实年龄'
      if (!w.group_id) errs.group_id = '选分组'
      this.setData({ claimErrors: errs })
      if (Object.keys(errs).length) return
      payload = { worker: { ...w, age, years: +w.years || 0 } }
    } else {
      if (!this.data.claimSel) return wx.showToast({ title: '先选一位工友', icon: 'none' })
      payload = { worker_id: this.data.claimSel }
    }
    api.bindClaim(this.data.claim.ticket, payload)
      .then(r => {
        wx.showToast({ title: `已绑定 ${r.worker.name}`, icon: 'success' })
        this.setData({ claim: null })
        this.load()
      })
      .catch(e => {
        wx.showToast({ title: (e && e.error) || '绑定失败，让工人刷新二维码重试', icon: 'none' })
        this.setData({ claim: null })
      })
  }
})
