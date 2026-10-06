const api = require('../../utils/api')
const config = require('../../config')
const drawQrcode = require('../../utils/qrcode')

const JOB_CLS = {
  '架子工': 'tag-j1', '钢筋工': 'tag-j2', '混凝土工': 'tag-j3',
  '木工': 'tag-j4', '电工': 'tag-j5', '塔吊司机': 'tag-j6', '其他': 'tag-j7'
}

// 工人详细学习情况：A 档案状态 / B 薄弱点TOP3 / C 学习总览 / D 复训计划 / E 记录时间线
// 设计原则：班组长 3 秒看懂状态，10 秒知道该干嘛，30 秒拿到证据
Page({
  data: {
    id: '',
    d: null,
    err: '',
    expandedRec: -1,   // 展开的记录下标
    reviewCal: null,   // { month, day }
    showBind: false,
    bind: null         // { qr_text, scene }
  },

  onLoad(opt) {
    const id = opt.id || 'w001'
    this.setData({ id })
    api.adminWorker(id)
      .then(d => {
        d.worker._cls = JOB_CLS[d.worker.job] || 'tag-j7'
        let reviewCal = null
        if (d.review && d.review.date) {
          const p = d.review.date.split('-')
          reviewCal = { month: +p[1], day: +p[2] }
        }
        this.setData({ d, reviewCal })
      })
      .catch(() => this.setData({ err: '学习情况加载失败，请返回重试' }))
  },

  noop() {},   // 拦截半屏内部点击，别穿透到遮罩关闭
  toggleRec(e) {
    const i = +e.currentTarget.dataset.i
    this.setData({ expandedRec: this.data.expandedRec === i ? -1 : i })
  },

  // 「为他推送巩固内容」→ 跳界面一预填（针对最薄弱知识点，对象=他本人）
  pushForHim() {
    const d = this.data.d
    const weakest = d.mastery && d.mastery[0]
    wx.setStorageSync('push_prefill', {
      task_text: weakest ? weakest.point : '',
      note: `针对 ${d.worker.name} 的薄弱点巩固`,
      target: 'worker:' + d.worker.worker_id
    })
    wx.switchTab({ url: '/pages/admin/push' })
  },

  openBind() {
    this.loadBind()
  },
  // 原生 canvas 不跟滚动、层级错乱——画到屏外画布再转图片，用 <image> 显示
  renderQr(text, size) {
    drawQrcode({ canvasId: 'bindQr', _this: this, text, width: size, height: size })
    setTimeout(() => {
      wx.canvasToTempFilePath({
        canvasId: 'bindQr', x: 0, y: 0, width: size, height: size,
        success: res => this.setData({ 'bind.qr_img': res.tempFilePath }),
        fail: () => {}
      }, this)
    }, 500)
  },
  // 拉/重发该工人的绑定码：regenerate=true 会作废旧码（防码外流后被冒用）
  // 后端配好 AppSecret 后返回 wxacode_url（官方小程序码图，微信扫一扫直进）；否则降级文本码
  loadBind(regenerate) {
    api.bindCode(this.data.id, regenerate)
      .then(r => {
        if (r.wxacode_url) r.wxacode_img = config.API_BASE + r.wxacode_url
        this.setData({ showBind: true, bind: r }, () => {
          if (!r.wxacode_img) this.renderQr(r.qr_text, 240)
        })
      })
      .catch(() => wx.showToast({ title: '生成失败', icon: 'none' }))
  },
  regenerate() {
    wx.showModal({
      title: '重发绑定码？',
      content: '旧码立即作废，之前打印的码将不能再绑定。',
      confirmText: '重发',
      success: r => { if (r.confirm) this.loadBind(true) }
    })
  },
  closeBind() {
    this.setData({ showBind: false })
  }
})
