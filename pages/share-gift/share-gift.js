Page({
  data: {
    qrCodePath: '/QRcode.png',
    qrLoadFailed: false
  },

  onQrLoad() {
    if (this.data.qrLoadFailed) this.setData({ qrLoadFailed: false })
  },

  onQrError() {
    this.setData({ qrLoadFailed: true })
  },

  previewQr() {
    if (this.data.qrLoadFailed) {
      wx.showToast({ title: '客服二维码加载失败，请重新进入页面', icon: 'none' })
      return
    }
    wx.previewImage({
      current: this.data.qrCodePath,
      urls: [this.data.qrCodePath]
    })
  }
})
