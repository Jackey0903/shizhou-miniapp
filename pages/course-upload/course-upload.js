const cloudApi = require('../../utils/cloudApi')

const EMPTY_SUBJECT = {
  id: '',
  name: '',
  description: '',
  color: '#2563EB',
  sort: '',
  enabled: true
}

const EMPTY_BANK = {
  id: '',
  subjectId: '',
  name: '',
  series: '基础题库',
  description: '',
  isLocked: false,
  sort: '',
  enabled: true
}

Page({
  data: {
    loading: true,
    hasAccess: false,
    saving: false,
    tree: [],
    subjectOptions: [],
    subjectIndex: 0,
    showSubjectForm: false,
    showBankForm: false,
    subjectForm: { ...EMPTY_SUBJECT },
    bankForm: { ...EMPTY_BANK }
  },

  async onShow() {
    await this.loadTree()
  },

  async loadTree() {
    this.setData({ loading: true })
    try {
      await cloudApi.assertAdmin()
      const tree = await cloudApi.getAdminCourseTree()
      const subjectOptions = tree
        .filter((item) => !item.virtual)
        .map((item) => ({ id: item._id, name: item.name }))
      this.setData({
        hasAccess: true,
        tree,
        subjectOptions,
        loading: false
      })
    } catch (err) {
      this.setData({ hasAccess: false, loading: false })
      wx.showToast({ title: err.message || '加载失败', icon: 'none' })
    }
  },

  openSubjectForm(e) {
    const id = e && e.currentTarget && e.currentTarget.dataset.id
    const subject = id ? this.data.tree.find((item) => item._id === id) : null
    this.setData({
      showSubjectForm: true,
      showBankForm: false,
      subjectForm: subject
        ? {
            id: subject._id,
            name: subject.name || '',
            description: subject.description || '',
            color: subject.color || '#2563EB',
            sort: String(subject.sort === undefined ? '' : subject.sort),
            enabled: subject.enabled !== false
          }
        : { ...EMPTY_SUBJECT }
    })
  },

  openBankForm(e) {
    const id = e && e.currentTarget && e.currentTarget.dataset.id
    let bank = null
    this.data.tree.some((subject) => {
      bank = (subject.banks || []).find((item) => item._id === id)
      return !!bank
    })
    const subjectId = (bank && bank.subjectId)
      || (e && e.currentTarget && e.currentTarget.dataset.subjectid)
      || (this.data.subjectOptions[0] && this.data.subjectOptions[0].id)
      || ''
    const subjectIndex = Math.max(0, this.data.subjectOptions.findIndex((item) => item.id === subjectId))
    this.setData({
      showSubjectForm: false,
      showBankForm: true,
      subjectIndex,
      bankForm: bank
        ? {
            id: bank._id,
            subjectId,
            name: bank.name || '',
            series: bank.series || '基础题库',
            description: bank.description || '',
            isLocked: !!bank.isLocked,
            sort: String(bank.sort === undefined ? '' : bank.sort),
            enabled: bank.enabled !== false
          }
        : { ...EMPTY_BANK, subjectId }
    })
  },

  closeForms() {
    this.setData({ showSubjectForm: false, showBankForm: false })
  },

  onSubjectInput(e) {
    const field = e.currentTarget.dataset.field
    this.setData({ [`subjectForm.${field}`]: e.detail.value })
  },

  onBankInput(e) {
    const field = e.currentTarget.dataset.field
    this.setData({ [`bankForm.${field}`]: e.detail.value })
  },

  onSubjectEnabledChange(e) {
    this.setData({ 'subjectForm.enabled': !!e.detail.value.length })
  },

  onBankEnabledChange(e) {
    this.setData({ 'bankForm.enabled': !!e.detail.value.length })
  },

  onLockChange(e) {
    this.setData({ 'bankForm.isLocked': !!e.detail.value.length })
  },

  onSubjectChange(e) {
    const subjectIndex = Number(e.detail.value)
    const subject = this.data.subjectOptions[subjectIndex]
    this.setData({
      subjectIndex,
      'bankForm.subjectId': subject ? subject.id : ''
    })
  },

  async saveSubject() {
    if (this.data.saving) return
    const form = this.data.subjectForm
    if (!form.name.trim()) {
      wx.showToast({ title: '请填写模块名称', icon: 'none' })
      return
    }
    this.setData({ saving: true })
    try {
      await cloudApi.saveAdminSubject({
        ...form,
        name: form.name.trim(),
        description: form.description.trim(),
        sort: form.sort === '' ? Date.now() : Number(form.sort)
      })
      this.setData({ showSubjectForm: false, subjectForm: { ...EMPTY_SUBJECT } })
      await this.loadTree()
      wx.showToast({ title: '模块已保存', icon: 'success' })
    } catch (err) {
      wx.showToast({ title: err.message || '保存失败', icon: 'none' })
    } finally {
      this.setData({ saving: false })
    }
  },

  async saveBank() {
    if (this.data.saving) return
    const form = this.data.bankForm
    if (!form.subjectId || !form.name.trim()) {
      wx.showToast({ title: '请选择模块并填写题库名称', icon: 'none' })
      return
    }
    this.setData({ saving: true })
    try {
      await cloudApi.saveAdminQuestionBank({
        ...form,
        name: form.name.trim(),
        series: form.series.trim() || '基础题库',
        description: form.description.trim(),
        sort: form.sort === '' ? Date.now() : Number(form.sort)
      })
      this.setData({ showBankForm: false, bankForm: { ...EMPTY_BANK } })
      await this.loadTree()
      wx.showToast({ title: '题库已保存', icon: 'success' })
    } catch (err) {
      wx.showToast({ title: err.message || '保存失败', icon: 'none' })
    } finally {
      this.setData({ saving: false })
    }
  },

  async toggleSubject(e) {
    await this.toggle('subjects', e.currentTarget.dataset.id, !e.currentTarget.dataset.enabled)
  },

  async toggleBank(e) {
    await this.toggle('question_banks', e.currentTarget.dataset.id, !e.currentTarget.dataset.enabled)
  },

  async toggle(target, id, enabled) {
    const confirmed = await new Promise((resolve) => {
      wx.showModal({
        title: enabled ? '确认上线' : '确认下线',
        content: enabled ? '用户将可以看到该内容。' : '下线后用户端不再显示，历史题目和学习记录不会删除。',
        success: (res) => resolve(!!res.confirm),
        fail: () => resolve(false)
      })
    })
    if (!confirmed) return
    try {
      await cloudApi.toggleAdminContent(target, id, enabled)
      await this.loadTree()
      wx.showToast({ title: enabled ? '已上线' : '已下线', icon: 'success' })
    } catch (err) {
      wx.showToast({ title: err.message || '操作失败', icon: 'none' })
    }
  }
})
