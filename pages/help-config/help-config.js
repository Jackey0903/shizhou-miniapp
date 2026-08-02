const cloudApi = require('../../utils/cloudApi')

const DEFAULT_FAQ_TEXT = [
  '课程、题库点不开怎么办？｜先重新进入对应页面再试一次；如果仍然异常，可以截图当前页面和操作步骤发给客服。',
  '督学匹配后下一步做什么？｜完成开通后，扫码联系客服，由客服协助开通后续督学服务。',
  '为什么没有收到提醒？｜完成开通后请扫码联系客服，确认已开通对应服务。'
].join('\n')

function faqListToText(list = []) {
  if (!Array.isArray(list) || !list.length) return DEFAULT_FAQ_TEXT
  return list.map((item) => `${item.question || ''}｜${item.answer || ''}`).join('\n')
}

function parseFaqText(text = '') {
  return text.split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split('｜')
      return {
        question: (parts[0] || '').trim(),
        answer: parts.slice(1).join('｜').trim()
      }
    })
    .filter((item) => item.question && item.answer)
}

Page({
  data: {
    id: '',
    title: '帮助与反馈',
    desc: '遇到页面打不开、数据异常、提醒未送达等问题，可以先看下方说明，再联系客服处理。',
    qrCodePath: '/QRcode.webp',
    copyGuide: '请添加仕舟客服，并附上问题截图、页面名称、复现步骤。',
    faqText: DEFAULT_FAQ_TEXT,
    loading: false
  },

  onShow() {
    this.loadConfig()
  },

  async loadConfig() {
    const res = await cloudApi.listAdminConfigs('help_config')
    const list = (res.result && res.result.data) || []
    const config = list[0]
    if (!config) return
    this.setData({
      id: config._id,
      title: config.title || this.data.title,
      desc: config.desc || this.data.desc,
      qrCodePath: config.qrCodePath || this.data.qrCodePath,
      copyGuide: config.copyGuide || this.data.copyGuide,
      faqText: faqListToText(config.faqList)
    })
  },

  onInput(e) {
    const field = e.currentTarget.dataset.field
    this.setData({ [field]: e.detail.value })
  },

  async chooseQrCode() {
    try {
      const res = await wx.chooseMedia({
        count: 1,
        mediaType: ['image'],
        sourceType: ['album']
      })
      const file = (res.tempFiles || [])[0]
      if (!file || !file.tempFilePath) return
      wx.showLoading({ title: '上传中', mask: true })
      const ext = file.tempFilePath.split('.').pop() || 'jpg'
      const uploaded = await wx.cloud.uploadFile({
        cloudPath: `help/customer-service-${Date.now()}.${ext}`,
        filePath: file.tempFilePath
      })
      this.setData({ qrCodePath: uploaded.fileID })
      wx.showToast({ title: '二维码已选择', icon: 'success' })
    } catch (err) {
      if (!String(err && err.errMsg || '').includes('cancel')) {
        wx.showToast({ title: '上传失败', icon: 'none' })
      }
    } finally {
      wx.hideLoading()
    }
  },

  async submit() {
    const faqList = parseFaqText(this.data.faqText)
    if (!faqList.length) {
      wx.showToast({ title: '请至少填写一条 FAQ', icon: 'none' })
      return
    }
    this.setData({ loading: true })
    try {
      const res = await cloudApi.saveAdminConfig('help_config', {
        id: this.data.id,
        title: this.data.title,
        desc: this.data.desc,
        qrCodePath: this.data.qrCodePath,
        copyGuide: this.data.copyGuide,
        faqList,
        enabled: true,
        sort: 1
      })
      if (res.result && res.result.code === 0) {
        wx.showToast({ title: '帮助配置已保存', icon: 'success' })
        await this.loadConfig()
      } else {
        wx.showToast({ title: (res.result && res.result.msg) || '保存失败', icon: 'none' })
      }
    } catch (err) {
      wx.showToast({ title: err.message || '保存失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  }
})
