function compareVersion(v1, v2) {
  const a = String(v1 || '').split('.')
  const b = String(v2 || '').split('.')
  const len = Math.max(a.length, b.length)
  while (a.length < len) a.push('0')
  while (b.length < len) b.push('0')
  for (let i = 0; i < len; i += 1) {
    const n1 = parseInt(a[i], 10) || 0
    const n2 = parseInt(b[i], 10) || 0
    if (n1 > n2) return 1
    if (n1 < n2) return -1
  }
  return 0
}

function parseIosMajor(system = '') {
  const match = String(system).match(/iOS\s+(\d+)/i)
  return match ? Number(match[1]) : 0
}

function getVirtualPaymentSupport() {
  let info = {}
  try {
    info = wx.getSystemInfoSync()
  } catch (err) {}

  const hasApi = compareVersion(info.SDKVersion, '2.19.2') >= 0
    || !!(wx.canIUse && wx.canIUse('requestVirtualPayment'))

  if (!hasApi) {
    return { ok: false, message: '当前微信版本不支持小程序虚拟支付，请升级微信后重试' }
  }

  const isIOS = String(info.platform || '').toLowerCase() === 'ios' || /iOS/i.test(info.system || '')
  if (isIOS) {
    const iosMajor = parseIosMajor(info.system)
    if (iosMajor && iosMajor < 15) {
      return { ok: false, message: 'iOS端虚拟支付需 iOS 15 及以上，请升级系统后重试' }
    }
    if (info.version && compareVersion(info.version, '8.0.68') < 0) {
      return { ok: false, message: 'iOS端虚拟支付需微信 8.0.68 及以上，请升级微信后重试' }
    }
  }

  return { ok: true, message: '' }
}

function canUseVirtualPayment() {
  return getVirtualPaymentSupport().ok
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)))
}

function loginOnce() {
  return new Promise((resolve, reject) => {
    wx.login({
      success(res) {
        if (res.code) resolve(res.code)
        else reject(new Error('支付登录凭证获取失败'))
      },
      fail(err) {
        reject(new Error((err && err.errMsg) || '支付登录凭证获取失败'))
      }
    })
  })
}

async function login(options = {}) {
  const retries = Math.max(0, Number(options.retries === undefined ? 2 : options.retries) || 0)
  const retryDelay = Math.max(0, Number(options.retryDelay === undefined ? 250 : options.retryDelay) || 0)
  let lastError = null

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await loginOnce()
    } catch (err) {
      lastError = err
      if (attempt < retries) await wait(retryDelay * (attempt + 1))
    }
  }

  const message = lastError && lastError.message
    ? lastError.message
    : '支付登录凭证获取失败'
  throw new Error(`${message}，请退出当前页后重试`)
}

async function createOrder(planCode) {
  let response = null
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const jsCode = await login()
    response = await wx.cloud.callFunction({
      name: 'createVipOrder',
      data: { planCode, jsCode }
    })
    const result = response && response.result
    if (!result || result.errorCode !== 'PAY_LOGIN_REQUIRED' || attempt === 1) return response
  }
  return response
}

function requestVirtualPayment(payment) {
  const support = getVirtualPaymentSupport()
  if (!support.ok) {
    return Promise.reject(new Error(support.message))
  }
  if (!payment || !payment.signData || !payment.paySig || !payment.signature) {
    return Promise.reject(new Error('虚拟支付参数不完整'))
  }
  return new Promise((resolve, reject) => {
    wx.requestVirtualPayment({
      signData: payment.signData,
      paySig: payment.paySig,
      signature: payment.signature,
      mode: payment.mode || 'short_series_goods',
      success: resolve,
      fail: reject
    })
  })
}

module.exports = {
  login,
  createOrder,
  requestVirtualPayment,
  canUseVirtualPayment,
  getVirtualPaymentSupport
}
