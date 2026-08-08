#!/usr/bin/env node
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const automator = require('miniprogram-automator')

const root = path.resolve(__dirname, '..')
const outputDir = path.join(root, 'tmp', 'qa-devtools-images')
const wsEndpoint = process.env.MINIPROGRAM_WS_ENDPOINT || 'ws://127.0.0.1:9420'

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function imageInfo(miniProgram, filePath) {
  return miniProgram.evaluate((source) => new Promise((resolve) => {
    wx.getImageInfo({
      src: source,
      success: (info) => resolve({
        ok: true,
        width: info.width,
        height: info.height,
        type: info.type || ''
      }),
      fail: (error) => resolve({ ok: false, error: error.errMsg || String(error) })
    })
  }), filePath)
}

async function main() {
  fs.rmSync(outputDir, { recursive: true, force: true })
  fs.mkdirSync(outputDir, { recursive: true })
  const miniProgram = await automator.connect({ wsEndpoint })
  const results = []

  async function test(name, fn) {
    const startedAt = Date.now()
    try {
      const detail = await fn()
      results.push({ name, status: 'passed', detail, durationMs: Date.now() - startedAt })
      console.log(`${name}: passed`)
    } catch (error) {
      results.push({
        name,
        status: 'failed',
        reason: String(error && (error.stack || error.message || error)).replace(/\s+/g, ' ').slice(0, 1200),
        durationMs: Date.now() - startedAt
      })
      console.log(`${name}: failed`)
    }
  }

  try {
    await test('打卡海报 1080 正方形生成', async () => {
      const page = await miniProgram.reLaunch('/pages/checkin/checkin?alreadyChecked=1')
      await wait(3000)
      await page.setData({ checkedToday: true, shareReady: true, enteredAfterCheckin: true })
      const generated = await miniProgram.evaluate(() => {
        const current = getCurrentPages().slice(-1)[0]
        return new Promise((resolve) => {
          current.buildShareImageFile()
            .then((filePath) => resolve({ ok: true, filePath }))
            .catch((error) => resolve({ ok: false, error: error.errMsg || error.message || String(error) }))
        })
      })
      assert(generated.ok, generated.error || '海报生成失败')
      const info = await imageInfo(miniProgram, generated.filePath)
      assert(info.ok, info.error || '海报无法解析')
      assert.strictEqual(info.width, 1080)
      assert.strictEqual(info.height, 1080)
      return info
    })

    await test('默认壁纸分享图与保存图生成', async () => {
      await miniProgram.reLaunch('/pages/wallpaper/wallpaper')
      await wait(3000)
      const files = await miniProgram.evaluate(() => {
        const current = getCurrentPages().slice(-1)[0]
        const item = {
          _id: 'qa-local',
          imageUrl: '/assets/images/default-wallpaper-1.webp',
          source: 'system'
        }
        return new Promise((resolve) => {
          Promise.all([
            current.buildShareImageFile(item),
            current.resolveImageFile(item).then((source) => current.convertPackageImageForAlbum(source))
          ])
            .then(([share, save]) => resolve({ ok: true, share, save }))
            .catch((error) => resolve({ ok: false, error: error.errMsg || error.message || String(error) }))
        })
      })
      assert(files.ok, files.error || '壁纸生成失败')
      const [share, save] = await Promise.all([
        imageInfo(miniProgram, files.share),
        imageInfo(miniProgram, files.save)
      ])
      assert(share.ok && share.width === 1080 && share.height === 1080, '壁纸分享图尺寸错误')
      assert(save.ok && save.width === 900 && save.height === 1600, '壁纸保存图尺寸错误')
      return { share, save }
    })

    await test('壁纸编辑竖版与分享图生成', async () => {
      const page = await miniProgram.reLaunch(
        '/pages/wallpaper-editor/wallpaper-editor?src=%2Fassets%2Fimages%2Fdefault-wallpaper-1.webp'
      )
      await wait(3000)
      await page.setData({ customText: '仕舟自动验收', includeQuestion: false })
      const files = await miniProgram.evaluate(() => {
        const current = getCurrentPages().slice(-1)[0]
        return new Promise((resolve) => {
          Promise.all([current.buildPosterFile(true), current.buildShareImageFile(true)])
            .then(([poster, share]) => resolve({ ok: true, poster, share }))
            .catch((error) => resolve({ ok: false, error: error.errMsg || error.message || String(error) }))
        })
      })
      assert(files.ok, files.error || '编辑壁纸生成失败')
      const [poster, share] = await Promise.all([
        imageInfo(miniProgram, files.poster),
        imageInfo(miniProgram, files.share)
      ])
      assert(poster.ok && poster.width === 750 && poster.height === 1334, '编辑壁纸尺寸错误')
      assert(share.ok && share.width === 1080 && share.height === 1080, '编辑分享图尺寸错误')
      return { poster, share }
    })

    await test('分享有礼客服二维码显示', async () => {
      const page = await miniProgram.reLaunch('/pages/share-gift/share-gift')
      await wait(1500)
      const data = await page.data()
      const image = await page.$('.sg-qrcode')
      assert(image, '客服二维码元素不存在')
      const [source, display] = await Promise.all([
        imageInfo(miniProgram, data.qrCodePath),
        image.size()
      ])
      assert.strictEqual(data.qrLoadFailed, false)
      assert(source.ok && source.width > 100 && source.height > 100, '客服二维码源文件无效')
      assert(display.width > 100 && display.height > 100, '客服二维码显示区域无效')
      return { source, display }
    })

    await test('正式小程序码下载解析', async () => {
      const page = await miniProgram.reLaunch('/pages/miniapp-code/miniapp-code')
      await wait(3500)
      const data = await page.data()
      assert(data.generated && /^cloud:\/\//.test(data.fileId || ''), '正式小程序码记录未加载')
      const source = await miniProgram.evaluate((fileId) => new Promise((resolve) => {
        wx.cloud.downloadFile({
          fileID: fileId,
          success: (download) => {
            wx.getImageInfo({
              src: download.tempFilePath,
              success: (info) => resolve({ ok: true, width: info.width, height: info.height, type: info.type || '' }),
              fail: (error) => resolve({ ok: false, error: error.errMsg || String(error) })
            })
          },
          fail: (error) => resolve({ ok: false, error: error.errMsg || String(error) })
        })
      }), data.fileId)
      assert(source.ok && source.width > 100 && source.height > 100, source.error || '正式小程序码无效')

      await page.callMethod('requestPrivacyConsent', '/tmp/qa-miniapp-code.jpg', '《测试隐私指引》')
      assert.strictEqual(await page.data('showPrivacyDialog'), true)
      await page.callMethod('handleRejectPrivacyAuthorization')
      assert.strictEqual(await page.data('showPrivacyDialog'), false)
      return source
    })

    const failed = results.filter((item) => item.status === 'failed')
    const report = {
      generatedAt: new Date().toISOString(),
      counts: { passed: results.length - failed.length, failed: failed.length },
      results
    }
    const reportPath = path.join(outputDir, 'report.json')
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`)
    console.log(JSON.stringify({ counts: report.counts, report: reportPath }, null, 2))
    if (failed.length) process.exitCode = 1
  } finally {
    miniProgram.disconnect()
  }
}

main().catch((error) => {
  console.error(error.stack || error)
  process.exit(1)
})
