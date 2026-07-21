const assert = require('assert')
const fs = require('fs')
const path = require('path')

const imageSharing = require('../utils/imageSharing')

const root = path.resolve(__dirname, '..')

async function testCancelledShareDoesNotRequestAlbum() {
  let saveCalls = 0
  const result = await imageSharing.shareImageWithFallback('/tmp/poster.jpg', {
    wxApi: {
      showShareImageMenu({ fail }) {
        fail({ errMsg: 'showShareImageMenu:fail cancel' })
      },
      saveImageToPhotosAlbum() {
        saveCalls += 1
      }
    }
  })

  assert.strictEqual(result.status, 'cancelled')
  assert.strictEqual(saveCalls, 0, 'cancelling the share menu must not request album permission')
}

async function testPrivacyConsentIsRequestedBeforeAlbumWrite() {
  let saveCalls = 0
  let pendingPath = ''
  const result = await imageSharing.shareImageWithFallback('/tmp/poster.jpg', {
    wxApi: {
      getPrivacySetting({ success }) {
        success({ needAuthorization: true, privacyContractName: '《仕舟小程序隐私保护指引》' })
      },
      saveImageToPhotosAlbum() {
        saveCalls += 1
      }
    },
    skipShareMenu: true,
    onPrivacyRequired(filePath, privacyContractName) {
      pendingPath = filePath
      assert.strictEqual(privacyContractName, '《仕舟小程序隐私保护指引》')
    }
  })

  assert.strictEqual(result.status, 'privacy-required')
  assert.strictEqual(pendingPath, '/tmp/poster.jpg')
  assert.strictEqual(saveCalls, 0, 'album API must wait until the privacy agreement is accepted')
}

async function testDeniedAlbumPermissionCanRecoverAndRetry() {
  let saveCalls = 0
  let recoverCalls = 0
  const result = await imageSharing.shareImageWithFallback('/tmp/poster.jpg', {
    wxApi: {
      getPrivacySetting({ success }) {
        success({ needAuthorization: false })
      },
      saveImageToPhotosAlbum({ success, fail }) {
        saveCalls += 1
        if (saveCalls === 1) {
          fail({ errMsg: 'saveImageToPhotosAlbum:fail auth deny' })
          return
        }
        success({})
      }
    },
    skipShareMenu: true,
    async recoverAlbumPermission() {
      recoverCalls += 1
      return true
    }
  })

  assert.strictEqual(result.status, 'saved')
  assert.strictEqual(saveCalls, 2, 'album save should retry after permission is enabled')
  assert.strictEqual(recoverCalls, 1)
}

async function testUnsupportedShareFallsBackToAlbum() {
  let saveCalls = 0
  const result = await imageSharing.shareImageWithFallback('/tmp/poster.jpg', {
    wxApi: {
      getPrivacySetting({ success }) {
        success({ needAuthorization: false })
      },
      saveImageToPhotosAlbum({ success }) {
        saveCalls += 1
        success({})
      }
    }
  })

  assert.strictEqual(result.status, 'saved')
  assert.strictEqual(saveCalls, 1)
}

async function testPrivacyApiFailureStillShowsConsentUi() {
  let requested = false
  const result = await imageSharing.shareImageWithFallback('/tmp/poster.jpg', {
    wxApi: {
      getPrivacySetting({ success }) {
        success({ needAuthorization: false })
      },
      saveImageToPhotosAlbum({ fail }) {
        fail({ errMsg: 'saveImageToPhotosAlbum:fail privacy permission is not authorized', errno: 104 })
      }
    },
    skipShareMenu: true,
    onPrivacyRequired(filePath) {
      requested = filePath === '/tmp/poster.jpg'
    }
  })

  assert.strictEqual(result.status, 'privacy-required')
  assert.strictEqual(requested, true)
}

function testCheckinPageUsesRecoverablePermissionFlow() {
  const pageJs = fs.readFileSync(path.join(root, 'pages/checkin/checkin.js'), 'utf8')
  const pageWxml = fs.readFileSync(path.join(root, 'pages/checkin/checkin.wxml'), 'utf8')
  assert(pageJs.includes("require('../../utils/imageSharing')"), 'check-in page must use the tested image-sharing flow')
  assert(pageJs.includes('recoverAlbumPermission'), 'check-in page must recover a denied album permission')
  assert(pageWxml.includes('open-type="agreePrivacyAuthorization"'), 'check-in page must expose the official privacy consent button')
  assert(pageWxml.includes('bindagreeprivacyauthorization="handleAgreePrivacyAuthorization"'))
}

async function main() {
  await testCancelledShareDoesNotRequestAlbum()
  await testPrivacyConsentIsRequestedBeforeAlbumWrite()
  await testDeniedAlbumPermissionCanRecoverAndRetry()
  await testUnsupportedShareFallsBackToAlbum()
  await testPrivacyApiFailureStillShowsConsentUi()
  testCheckinPageUsesRecoverablePermissionFlow()
  console.log('image share permission regression checks passed')
}

main().catch((err) => {
  console.error(err.stack || err)
  process.exit(1)
})
