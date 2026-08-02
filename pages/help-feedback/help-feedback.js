const cloudApi = require('../../utils/cloudApi')

const DEFAULT_HELP = {
  title: '帮助与反馈',
  desc: '遇到页面打不开、数据异常、提醒未送达等问题，可以先看下方说明，再联系客服处理。',
  qrCodePath: '/QRcode.png',
  copyGuide: '请添加仕舟客服，并附上问题截图、页面名称、复现步骤。',
  faqList: [
      {
        question: '课程、题库点不开怎么办？',
        answer: '先重新进入对应页面再试一次；如果仍然异常，可以截图当前页面和操作步骤发给客服。'
      },
      {
        question: '督学匹配后下一步做什么？',
        answer: '完成开通后，扫码联系客服，由客服协助开通后续督学服务。'
      },
      {
        question: '为什么没有收到提醒？',
        answer: '完成开通后请扫码联系客服，确认已开通对应服务。'
      }
    ]
}

function normalizeFaqList(list = []) {
  return (Array.isArray(list) ? list : []).map((item) => {
    const question = item.question || ''
    if (question.includes('督学匹配后下一步')) {
      return {
        ...item,
        answer: '完成开通后，扫码联系客服，由客服协助开通后续督学服务。'
      }
    }
    if (question.includes('为什么没有收到提醒')) {
      return {
        ...item,
        answer: '完成开通后请扫码联系客服，确认已开通对应服务。'
      }
    }
    return item
  })
}

Page({
  data: {
    ...DEFAULT_HELP,
    faqList: normalizeFaqList(DEFAULT_HELP.faqList)
  },

  onLoad() {
    this.loadHelpConfig()
  },

  async loadHelpConfig() {
    const res = await cloudApi.getHelpConfig().catch(() => null)
    const config = res && res.result && res.result.code === 0 ? res.result.data : null
    if (!config) return
    this.setData({
      title: config.title || DEFAULT_HELP.title,
      desc: config.desc || DEFAULT_HELP.desc,
      qrCodePath: config.qrCodePath || DEFAULT_HELP.qrCodePath,
      copyGuide: config.copyGuide || DEFAULT_HELP.copyGuide,
      faqList: normalizeFaqList(Array.isArray(config.faqList) && config.faqList.length ? config.faqList : DEFAULT_HELP.faqList)
    })
  },

  previewQr() {
    wx.previewImage({
      current: this.data.qrCodePath,
      urls: [this.data.qrCodePath]
    })
  },

  copyGuide() {
    wx.setClipboardData({
      data: this.data.copyGuide,
      success: () => {
        wx.showToast({ title: '已复制说明', icon: 'success' })
      }
    })
  }
})
