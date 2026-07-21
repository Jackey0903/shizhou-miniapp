const assert = require('assert')
const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')

async function testVirtualPaymentLoginRetriesEmptyCode() {
  const modulePath = path.join(root, 'utils/virtualPayment.js')
  delete require.cache[require.resolve(modulePath)]

  let attempts = 0
  global.wx = {
    login({ success }) {
      attempts += 1
      success(attempts === 1 ? {} : { code: 'RECOVERED_LOGIN_CODE' })
    }
  }

  const virtualPayment = require(modulePath)
  const code = await virtualPayment.login({ retries: 2, retryDelay: 0 })
  assert.strictEqual(code, 'RECOVERED_LOGIN_CODE')
  assert.strictEqual(attempts, 2, 'an empty wx.login result should be retried')
  delete global.wx
}

async function testVirtualPaymentOrderRefreshesRejectedLoginCode() {
  const modulePath = path.join(root, 'utils/virtualPayment.js')
  delete require.cache[require.resolve(modulePath)]

  let loginAttempts = 0
  let orderAttempts = 0
  global.wx = {
    login({ success }) {
      loginAttempts += 1
      success({ code: `LOGIN_CODE_${loginAttempts}` })
    },
    cloud: {
      async callFunction(options) {
        orderAttempts += 1
        assert.strictEqual(options.data.jsCode, `LOGIN_CODE_${orderAttempts}`)
        if (orderAttempts === 1) {
          return { result: { code: -1002, errorCode: 'PAY_LOGIN_REQUIRED' } }
        }
        return { result: { code: 0, data: { payment: {} } } }
      }
    }
  }

  const virtualPayment = require(modulePath)
  const response = await virtualPayment.createOrder('basic_vip_year')
  assert.strictEqual(response.result.code, 0)
  assert.strictEqual(loginAttempts, 2, 'a rejected login code should be refreshed once')
  assert.strictEqual(orderAttempts, 2, 'order creation should retry once with the new code')
  delete global.wx
}

async function testVirtualPaymentReportsActionableClientError() {
  const modulePath = path.join(root, 'utils/virtualPayment.js')
  delete require.cache[require.resolve(modulePath)]
  let reported = null
  global.wx = {
    getSystemInfoSync() {
      return { platform: 'android', system: 'Android 14', SDKVersion: '3.7.8', version: '8.0.60' }
    },
    cloud: {
      async callFunction(options) {
        reported = options
        return { result: { code: 0 } }
      }
    }
  }

  const virtualPayment = require(modulePath)
  const error = { errCode: -15010, errMsg: 'requestVirtualPayment:fail product not published' }
  assert.match(virtualPayment.getPaymentErrorMessage(error), /未发布/)
  await virtualPayment.reportPaymentError('OUT_TRADE_123', error)
  assert.strictEqual(reported.name, 'createVipOrder')
  assert.strictEqual(reported.data.action, 'paymentClientError')
  assert.strictEqual(reported.data.errCode, -15010)
  assert.strictEqual(reported.data.clientInfo.platform, 'android')
  delete global.wx
}

function testCustomerServiceQrIsPackaged() {
  const page = fs.readFileSync(path.join(root, 'pages/share-gift/share-gift.js'), 'utf8')
  const match = page.match(/qrCodePath:\s*['"]([^'"]+)['"]/) 
  assert(match, 'share-gift must define a customer-service QR path')

  const qrPath = match[1].replace(/^\//, '')
  assert(fs.existsSync(path.join(root, qrPath)), `QR image does not exist: ${qrPath}`)

  const config = JSON.parse(fs.readFileSync(path.join(root, 'project.config.json'), 'utf8'))
  const ignored = ((config.packOptions || {}).ignore || []).some((item) => (
    item.type === 'file' && item.value === qrPath
  ))
  assert(!ignored, `QR image is excluded from upload: ${qrPath}`)
}

async function main() {
  await testVirtualPaymentLoginRetriesEmptyCode()
  await testVirtualPaymentOrderRefreshesRejectedLoginCode()
  await testVirtualPaymentReportsActionableClientError()
  testCustomerServiceQrIsPackaged()
  console.log('customer-reported issue regression checks passed')
}

main().catch((err) => {
  console.error(err.stack || err)
  process.exit(1)
})
