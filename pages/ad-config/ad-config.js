const cloudApi = require('../../utils/cloudApi')

const POSITION_OPTIONS = [
  {
    key: 'study-plan-banner',
    label: '学习计划页横幅',
    desc: '显示在学习计划页底部按钮上方'
  },
  {
    key: 'question-banner',
    label: '题目页横幅',
    desc: '显示在题目解析区和底部操作区上方'
  },
  {
    key: 'coin-reward-video',
    label: '舟币激励视频',
    desc: '显示在舟币明细页，用户完整看完后奖励 1 舟币'
  }
]

function withPositionMeta(list = []) {
  return list.map((item) => {
    const meta = POSITION_OPTIONS.find((option) => option.key === item.position) || {}
    return {
      ...item,
      positionLabel: meta.label || item.position,
      positionDesc: meta.desc || item.remark || ''
    }
  })
}

Page({
  data: {
    positionOptions: POSITION_OPTIONS,
    positionIndex: 0,
    list: [],
    name: '',
    unitId: '',
    remark: '',
    loading: false
  },

  onShow() {
    this.loadList()
  },

  async loadList() {
    const res = await cloudApi.listAdminConfigs('ad_slots')
    const list = (res.result && res.result.data) || []
    this.setData({ list: withPositionMeta(list) })
  },

  onInput(e) {
    const field = e.currentTarget.dataset.field
    this.setData({ [field]: e.detail.value })
  },

  onPositionChange(e) {
    const positionIndex = Number(e.detail.value)
    const option = POSITION_OPTIONS[positionIndex] || POSITION_OPTIONS[0]
    this.setData({
      positionIndex,
      name: option.label,
      remark: option.desc
    })
  },

  async submit() {
    const option = POSITION_OPTIONS[this.data.positionIndex]
    if (!option) {
      wx.showToast({ title: '请选择广告位', icon: 'none' })
      return
    }
    this.setData({ loading: true })
    try {
      const res = await cloudApi.saveAdminConfig('ad_slots', {
        name: this.data.name || option.label,
        position: option.key,
        unitId: this.data.unitId,
        adUnitId: this.data.unitId,
        remark: this.data.remark || option.desc,
        enabled: !!this.data.unitId,
        sort: positionIndexSort(option.key)
      })
      if (res.result && res.result.code === 0) {
        this.setData({
          positionIndex: 0,
          name: POSITION_OPTIONS[0].label,
          unitId: '',
          remark: POSITION_OPTIONS[0].desc
        })
        await this.loadList()
        wx.showToast({ title: '广告位已保存', icon: 'success' })
      } else {
        wx.showToast({ title: (res.result && res.result.msg) || '保存失败', icon: 'none' })
      }
    } catch (err) {
      wx.showToast({ title: err.message || '保存失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },

  async toggle(e) {
    try {
      const { id, enabled } = e.currentTarget.dataset
      const res = await cloudApi.toggleAdminConfig('ad_slots', id, !enabled)
      if (res.result && res.result.code === 0) await this.loadList()
    } catch (err) {
      wx.showToast({ title: err.message || '操作失败', icon: 'none' })
    }
  }
})

function positionIndexSort(key) {
  const index = POSITION_OPTIONS.findIndex((item) => item.key === key)
  return index >= 0 ? index + 1 : Date.now()
}
