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

const PAYMENT_ERROR_MESSAGES = {
  1001: '支付参数错误，请重新发起支付',
  '-1': '支付未完成，请稍后重试',
  '-2': '已取消支付',
  '-4': '支付被微信风控拦截，请换个时间或联系客服',
  '-5': '支付签约状态确认中，请稍后重试',
  '-15001': '支付参数错误，请联系客服',
  '-15002': '订单号已使用，请重新发起支付',
  '-15003': '微信支付系统繁忙，请稍后重试',
  '-15005': '支付登录态已失效，请退出当前页后重试',
  '-15006': '支付签名校验失败，请联系客服',
  '-15007': '支付登录态已过期，请重新发起支付',
  '-15008': '商户支付资料尚未完成，请联系客服',
  '-15010': '当前套餐尚未发布到微信支付，请联系客服',
  '-15011': '支付环境配置错误，请联系客服',
  '-15012': '微信支付下单失败，请重新发起',
  '-15013': '套餐价格与微信支付后台不一致，请联系客服',
  '-15014': '套餐刚发布尚未生效，请 10 分钟后重试',
  '-15016': '支付订单格式错误，请联系客服',
  '-15017': '商户收款功能受限，请联系客服',
  '-15018': '当前套餐未通过微信审核，请联系客服',
  '-15019': '商户收款功能受限，请联系客服',
  '-15020': '操作过快，请稍后重试',
  '-15021': '支付请求过于频繁，请稍后重试'
}

function getPaymentErrorCode(error = {}) {
  const direct = Number(error.errCode)
  if (Number.isFinite(direct)) return direct
  const text = String(error.errMsg || error.message || '')
  const match = text.match(/(?:errCode|err_code)\s*[:=]?\s*(-?\d+)/i)
  return match ? Number(match[1]) : 0
}

function getPaymentErrorMessage(error = {}) {
  const code = getPaymentErrorCode(error)
  if (PAYMENT_ERROR_MESSAGES[String(code)]) return PAYMENT_ERROR_MESSAGES[String(code)]
  const raw = String(error.message || error.errMsg || '').replace(/^requestVirtualPayment:\s*fail\s*/i, '').trim()
  if (raw && raw !== 'fail') return raw.slice(0, 120)
  return code ? `支付失败（错误码 ${code}）` : '支付失败，请稍后重试'
}

function reportPaymentError(outTradeNo, error = {}) {
  if (!outTradeNo || !wx.cloud || !wx.cloud.callFunction) return Promise.resolve(null)
  let clientInfo = {}
  try {
    const info = wx.getSystemInfoSync ? wx.getSystemInfoSync() : {}
    clientInfo = {
      platform: info.platform || '',
      system: info.system || '',
      SDKVersion: info.SDKVersion || '',
      version: info.version || ''
    }
  } catch (err) {}
  return wx.cloud.callFunction({
    name: 'createVipOrder',
    data: {
      action: 'paymentClientError',
      outTradeNo,
      errCode: getPaymentErrorCode(error),
      errMsg: String(error.errMsg || error.message || '').slice(0, 1000),
      clientInfo
    }
  })
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
  reportPaymentError,
  getPaymentErrorCode,
  getPaymentErrorMessage,
  canUseVirtualPayment,
  getVirtualPaymentSupport
}
