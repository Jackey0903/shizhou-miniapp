const cloudApi = require('../../utils/cloudApi')

const GROUPS = [
  {
    title: '题库与学习内容',
    items: [
      { title: '题目录入', icon: '题', url: '/pages/question-upload/question-upload' },
      { title: '模块与题库', icon: '库', url: '/pages/course-upload/course-upload' },
      { title: '磨耳朵音频', icon: '音', url: '/pages/audio-upload/audio-upload' },
      { title: '领取资料', icon: '资', url: '/pages/material-upload/material-upload' },
      { title: '平台壁纸', icon: '图', url: '/pages/wallpaper-upload/wallpaper-upload' }
    ]
  },
  {
    title: '运营配置',
    items: [
      { title: '打卡海报', icon: '海', url: '/pages/punch-background-config/punch-background-config' },
      { title: '励志文字', icon: '文', url: '/pages/punch-quote-config/punch-quote-config' },
      { title: '广告位', icon: '广', url: '/pages/ad-config/ad-config' },
      { title: '帮助与反馈', icon: '助', url: '/pages/help-config/help-config' },
      { title: '站内群发', icon: '信', url: '/pages/message-config/message-config' },
      { title: '学习提醒', icon: '醒', url: '/pages/reminder-config/reminder-config' }
    ]
  },
  {
    title: '用户与交付',
    items: [
      { title: '用户权限赠送', icon: '权', url: '/pages/user-access-admin/user-access-admin' },
      { title: '正式小程序码', icon: '码', url: '/pages/miniapp-code/miniapp-code' },
      { title: 'VIP套餐', icon: 'VIP', url: '/pages/vip-plan-config/vip-plan-config' }
    ]
  }
]

Page({
  data: {
    groups: GROUPS,
    checking: true,
    authorized: false
  },

  async onLoad() {
    try {
      await cloudApi.assertAdmin()
      this.setData({ authorized: true })
    } catch (err) {
      wx.showModal({
        title: '无管理员权限',
        content: '当前账号不是管理员，无法进入工作台。',
        showCancel: false,
        success: () => wx.navigateBack()
      })
    } finally {
      this.setData({ checking: false })
    }
  }
})
