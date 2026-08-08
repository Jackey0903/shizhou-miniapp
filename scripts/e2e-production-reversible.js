#!/usr/bin/env node
const assert = require('assert')
const childProcess = require('child_process')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const automator = require('miniprogram-automator')

const root = path.resolve(__dirname, '..')
const outputDir = path.join(root, 'tmp', 'qa-production-reversible')
const wsEndpoint = process.env.MINIPROGRAM_WS_ENDPOINT || 'ws://127.0.0.1:9420'
const expectedPhone = process.env.QA_PHONE || '13950786351'
const bundledCli = path.join(root, 'tmp', 'cloudbase-cli', 'node_modules', '.bin', 'tcb')
const cli = process.env.TCB_CLI || (fs.existsSync(bundledCli) ? bundledCli : 'tcb')

function runDatabase(commands) {
  let lastError = null
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const result = childProcess.spawnSync(cli, [
      'db', 'nosql', 'execute', '--json', '--command', JSON.stringify(commands)
    ], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, NO_COLOR: '1' }
    })
    if (result.error) lastError = result.error
    else if (result.status === 0) return
    else {
      lastError = new Error(String(
        `${result.stderr || ''} ${result.stdout || ''}` || '数据库操作失败'
      ).replace(/\s+/g, ' ').slice(0, 1600))
    }
    if (attempt < 3) {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, attempt * 1000)
    }
  }
  throw lastError || new Error('数据库操作失败')
}

function removeDocument(table, filter) {
  runDatabase([{
    TableName: table,
    CommandType: 'DELETE',
    Command: JSON.stringify({ delete: table, deletes: [{ q: filter, limit: 1 }] })
  }])
}

function insertDocument(table, document) {
  runDatabase([{
    TableName: table,
    CommandType: 'INSERT',
    Command: JSON.stringify({ insert: table, documents: [document] })
  }])
}

function restoreCoins(userId, coins) {
  runDatabase([{
    TableName: 'users',
    CommandType: 'UPDATE',
    Command: JSON.stringify({
      update: 'users',
      updates: [{ q: { _id: userId }, u: { $set: { coins } }, multi: false }]
    })
  }])
}

async function callCloud(miniProgram, name, data = {}) {
  const response = await miniProgram.evaluate((functionName, payload) => new Promise((resolve) => {
    wx.cloud.callFunction({
      name: functionName,
      data: payload,
      success: (result) => resolve({ ok: true, result: result.result }),
      fail: (error) => resolve({ ok: false, error: error.errMsg || error.message || String(error) })
    })
  }), name, data)
  if (!response.ok) throw new Error(response.error || `${name} 云函数调用失败`)
  return response.result
}

function dateAfter(days) {
  const date = new Date(Date.now() + days * 86400000)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function silentWavBase64() {
  const sampleRate = 8000
  const samples = 800
  const dataSize = samples * 2
  const buffer = Buffer.alloc(44 + dataSize)
  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + dataSize, 4)
  buffer.write('WAVE', 8)
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * 2, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(dataSize, 40)
  return buffer.toString('base64')
}

async function main() {
  fs.rmSync(outputDir, { recursive: true, force: true })
  fs.mkdirSync(outputDir, { recursive: true })
  const miniProgram = await automator.connect({ wsEndpoint })
  const results = []
  let currentUser = null

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
        reason: String(error && (error.stack || error.message || error)).replace(/\s+/g, ' ').slice(0, 1600),
        durationMs: Date.now() - startedAt
      })
      console.log(`${name}: failed`)
    }
  }

  try {
    const userResult = await callCloud(miniProgram, 'userLogin', { action: 'getCurrentUser' })
    assert.strictEqual(Number(userResult.code), 0, userResult.msg || '当前用户未登录')
    currentUser = userResult.data
    assert(currentUser && currentUser._id && currentUser._openid, '当前用户标识不完整')
    assert.strictEqual(String(currentUser.phone || ''), expectedPhone, `当前验收账号不是 ${expectedPhone}`)

    await test('学习计划新建、回读和删除', async () => {
      const [plansResult, coursesResult] = await Promise.all([
        callCloud(miniProgram, 'savePlan', { action: 'list' }),
        callCloud(miniProgram, 'getCourses', {})
      ])
      assert.strictEqual(Number(plansResult.code), 0, plansResult.error || '学习计划加载失败')
      assert.strictEqual(Number(coursesResult.code), 0, coursesResult.msg || '题库加载失败')
      const originalPlans = plansResult.data || []
      const existingCourseIds = new Set(originalPlans.map((item) => item.courseId))
      const candidates = (coursesResult.data || []).filter((item) => item && item._id && !existingCourseIds.has(item._id))
      assert(candidates.length, '没有可用于回滚验收的未建计划题库')

      let createdPlanId = ''
      let selectedCourseId = ''
      try {
        for (const course of candidates) {
          const response = await callCloud(miniProgram, 'savePlan', {
            action: 'save',
            courseId: course._id,
            dailyCount: 7,
            mode: 'random',
            deadline: dateAfter(14)
          })
          if (Number(response.code) === 0 && response.data && response.data.planId) {
            createdPlanId = response.data.planId
            selectedCourseId = course._id
            break
          }
        }
        assert(createdPlanId, '所有候选题库都无法创建临时学习计划')
        const afterCreate = await callCloud(miniProgram, 'savePlan', { action: 'list' })
        const created = (afterCreate.data || []).find((item) => item._id === createdPlanId)
        assert(created, '临时学习计划未能回读')
        assert.strictEqual(created.courseId, selectedCourseId)
        assert.strictEqual(Number(created.dailyCount), 7)
        assert.strictEqual(created.mode, 'random')
      } finally {
        if (createdPlanId) {
          const deleted = await callCloud(miniProgram, 'savePlan', { action: 'delete', planId: createdPlanId })
          if (Number(deleted.code) !== 0) removeDocument('plans', { _id: createdPlanId })
        }
      }

      const afterCleanup = await callCloud(miniProgram, 'savePlan', { action: 'list' })
      assert.strictEqual((afterCleanup.data || []).length, originalPlans.length, '学习计划清理后数量未恢复')
      return { originalCount: originalPlans.length, restored: true }
    })

    await test('答题持久化、幂等重试和清理', async () => {
      const [recordsResult, coursesResult] = await Promise.all([
        callCloud(miniProgram, 'submitAnswer', { action: 'list' }),
        callCloud(miniProgram, 'getCourses', {})
      ])
      assert.strictEqual(Number(recordsResult.code), 0, recordsResult.error || '答题记录加载失败')
      const originalRecords = recordsResult.data || []
      const existingQuestionIds = new Set(originalRecords.map((item) => item.questionId))
      let fixture = null
      for (const course of coursesResult.data || []) {
        const questionsResult = await callCloud(miniProgram, 'getQuestions', {
          courseId: course._id,
          skip: 0,
          limit: 30
        })
        if (Number(questionsResult.code) !== 0) continue
        const question = (questionsResult.data || []).find((item) => item._id && !existingQuestionIds.has(item._id))
        if (question) {
          fixture = { course, question }
          break
        }
      }
      assert(fixture, '未找到可回滚的未作答题目')

      const recordId = `study_${crypto.createHash('sha256')
        .update(`${currentUser._openid}:${fixture.question._id}`)
        .digest('hex')
        .slice(0, 32)}`
      const submissionId = `qa:${Date.now()}:${crypto.randomBytes(8).toString('hex')}`
      const payload = {
        questionId: fixture.question._id,
        courseId: fixture.course._id,
        result: 'maybe',
        userAnswer: '',
        userOptionIndex: 0,
        submissionId
      }
      try {
        const first = await callCloud(miniProgram, 'submitAnswer', payload)
        assert.strictEqual(Number(first.code), 0, first.error || '答题保存失败')
        const duplicate = await callCloud(miniProgram, 'submitAnswer', payload)
        assert.strictEqual(Number(duplicate.code), 0, duplicate.error || '答题重试失败')
        assert.strictEqual(duplicate.data && duplicate.data.duplicate, true, '重复提交未被幂等拦截')
        const afterSubmit = await callCloud(miniProgram, 'submitAnswer', { action: 'list' })
        assert((afterSubmit.data || []).some((item) => item.questionId === fixture.question._id), '答题记录未能回读')
      } finally {
        removeDocument('study_records', { _id: recordId })
      }

      const afterCleanup = await callCloud(miniProgram, 'submitAnswer', { action: 'list' })
      assert.strictEqual((afterCleanup.data || []).length, originalRecords.length, '答题记录清理后数量未恢复')
      assert(!(afterCleanup.data || []).some((item) => item.questionId === fixture.question._id), '临时答题记录未清理')
      return { originalCount: originalRecords.length, duplicateBlocked: true, restored: true }
    })

    await test('打卡分享奖励 +10 舟币、幂等与恢复', async () => {
      const [checkinsResult, beforeUserResult] = await Promise.all([
        callCloud(miniProgram, 'checkin', {
          action: 'list',
          year: new Date().getFullYear(),
          month: new Date().getMonth() + 1
        }),
        callCloud(miniProgram, 'userLogin', { action: 'getCurrentUser' })
      ])
      assert.strictEqual(Number(checkinsResult.code), 0, checkinsResult.msg || '打卡记录加载失败')
      const originalCoins = Number(beforeUserResult.data.coins || 0)
      const today = dateAfter(0)
      const hasRealCheckin = (checkinsResult.data || []).some((item) => item.dateStr === today)
      const temporaryCheckinId = `qa_checkin_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`
      const claimId = `checkinShare:qa:${Date.now()}:${crypto.randomBytes(8).toString('hex')}`
      const rewardLogId = `reward_${crypto.createHash('sha256')
        .update(`${currentUser._openid}:${claimId}`)
        .digest('hex')
        .slice(0, 32)}`

      try {
        if (!hasRealCheckin) {
          insertDocument('checkins', {
            _id: temporaryCheckinId,
            _openid: currentUser._openid,
            dateStr: today,
            streak: Number(currentUser.streak || 0),
            coinsEarned: 0,
            qaTemporary: true
          })
        }
        const first = await callCloud(miniProgram, 'grantCoinReward', {
          action: 'checkinShareReward',
          claimId
        })
        assert.strictEqual(Number(first.code), 0, first.msg || '打卡分享奖励发放失败')
        assert.strictEqual(Number(first.data && first.data.amount), 10, '打卡分享奖励不是 10 舟币')
        assert.strictEqual(Number(first.data && first.data.coins), originalCoins + 10)

        const second = await callCloud(miniProgram, 'grantCoinReward', {
          action: 'checkinShareReward',
          claimId
        })
        assert.strictEqual(Number(second.code), 0, second.msg || '分享奖励重试失败')
        assert.strictEqual(second.data && second.data.duplicate, true, '重复奖励凭证未被幂等拦截')
        assert.strictEqual(Number(second.data && second.data.coins), originalCoins + 10, '重复奖励凭证错误增加舟币')
      } finally {
        removeDocument('coin_logs', { _id: rewardLogId })
        if (!hasRealCheckin) removeDocument('checkins', { _id: temporaryCheckinId })
        restoreCoins(currentUser._id, originalCoins)
      }

      const afterUser = await callCloud(miniProgram, 'userLogin', { action: 'getCurrentUser' })
      assert.strictEqual(Number(afterUser.data.coins), originalCoins, '分享奖励验收后舟币余额未恢复')
      return { reward: 10, duplicateReward: false, restoredCoins: originalCoins, restored: true }
    })

    await test('资料首次扣 10 舟币、重复不扣与恢复', async () => {
      const [materialsResult, beforeUserResult] = await Promise.all([
        callCloud(miniProgram, 'getMaterials', {}),
        callCloud(miniProgram, 'userLogin', { action: 'getCurrentUser' })
      ])
      assert.strictEqual(Number(materialsResult.code), 0, materialsResult.msg || '资料加载失败')
      assert.strictEqual(Number(beforeUserResult.code), 0, beforeUserResult.msg || '用户加载失败')
      const material = (materialsResult.data || []).find((item) => item && item._id && !item.owned)
      assert(material, '没有未领取资料可用于验收')
      const originalCoins = Number(beforeUserResult.data.coins || 0)
      assert(originalCoins >= 10, '验收账号舟币不足 10，无法验证资料扣费')

      const hash = crypto.createHash('sha256')
        .update(`${currentUser._openid}:${material._id}`)
        .digest('hex')
        .slice(0, 32)
      const redemptionId = `material_${hash}`
      const logId = `material_log_${hash}`
      try {
        const first = await callCloud(miniProgram, 'exchangeMaterial', { materialId: material._id })
        assert.strictEqual(Number(first.code), 0, first.msg || '资料领取失败')
        assert.strictEqual(first.data && first.data.alreadyOwned, false, '首次领取被错误识别为已领取')
        assert.strictEqual(Number(first.data.remainingCoins), originalCoins - 10)

        const second = await callCloud(miniProgram, 'exchangeMaterial', { materialId: material._id })
        assert.strictEqual(Number(second.code), 0, second.msg || '资料重复打开失败')
        assert.strictEqual(second.data && second.data.alreadyOwned, true, '重复打开未识别已领取')
        assert.strictEqual(Number(second.data.remainingCoins), originalCoins - 10, '重复打开错误扣币')
      } finally {
        removeDocument('material_redemptions', { _id: redemptionId })
        removeDocument('coin_logs', { _id: logId })
        restoreCoins(currentUser._id, originalCoins)
      }

      const [afterMaterials, afterUser] = await Promise.all([
        callCloud(miniProgram, 'getMaterials', {}),
        callCloud(miniProgram, 'userLogin', { action: 'getCurrentUser' })
      ])
      assert.strictEqual(Number(afterUser.data.coins), originalCoins, '舟币余额未恢复')
      const restoredMaterial = (afterMaterials.data || []).find((item) => item._id === material._id)
      assert(restoredMaterial && !restoredMaterial.owned, '资料领取状态未恢复')
      return { cost: 10, duplicateCharge: false, restoredCoins: originalCoins, restored: true }
    })

    await test('管理员资料、音频、壁纸真实上传与清理', async () => {
      const marker = `qa-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`
      let fileIds = []
      const documentIds = {}
      try {
        const uploaded = await miniProgram.evaluate((fixture) => {
          const fsManager = wx.getFileSystemManager()
          const write = (filePath, data) => new Promise((resolve, reject) => {
            fsManager.writeFile({ filePath, data, encoding: 'base64', success: resolve, fail: reject })
          })
          const upload = (cloudPath, filePath) => new Promise((resolve, reject) => {
            wx.cloud.uploadFile({ cloudPath, filePath, success: resolve, fail: reject })
          })
          return new Promise((resolve) => {
            const base = wx.env.USER_DATA_PATH
            const paths = {
              text: `${base}/${fixture.marker}.txt`,
              audio: `${base}/${fixture.marker}.wav`,
              image: `${base}/${fixture.marker}.png`
            }
            Promise.all([
              write(paths.text, fixture.textBase64),
              write(paths.audio, fixture.audioBase64),
              write(paths.image, fixture.imageBase64)
            ])
              .then(() => Promise.all([
                upload(`qa/${fixture.marker}.txt`, paths.text),
                upload(`qa/${fixture.marker}.wav`, paths.audio),
                upload(`qa/${fixture.marker}.png`, paths.image)
              ]))
              .then(([text, audio, image]) => resolve({
                ok: true,
                fileIds: [text.fileID, audio.fileID, image.fileID]
              }))
              .catch((error) => resolve({ ok: false, error: error.errMsg || error.message || String(error) }))
          })
        }, {
          marker,
          textBase64: Buffer.from('仕舟管理员上传自动验收\n', 'utf8').toString('base64'),
          audioBase64: silentWavBase64(),
          imageBase64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+3A0+WQAAAABJRU5ErkJggg=='
        })
        assert(uploaded.ok, uploaded.error || '临时文件上传失败')
        fileIds = uploaded.fileIds
        assert.strictEqual(fileIds.length, 3)

        const [textFileId, audioFileId, imageFileId] = fileIds
        documentIds.material = `material_${crypto.createHash('sha256')
          .update(`document:${textFileId}`)
          .digest('hex')
          .slice(0, 20)}`
        documentIds.audio = `audio_${crypto.createHash('sha256')
          .update(audioFileId)
          .digest('hex')
          .slice(0, 20)}`
        documentIds.wallpaper = `wallpaper_${crypto.createHash('sha256')
          .update(imageFileId)
          .digest('hex')
          .slice(0, 20)}`

        const [material, audio, wallpaper] = await Promise.all([
          callCloud(miniProgram, 'uploadMaterials', {
            materials: [{
              name: `QA资料-${marker}`,
              description: '可回滚生产验收',
              type: 'document',
              fileId: textFileId,
              sort: Date.now()
            }]
          }),
          callCloud(miniProgram, 'uploadAudios', {
            audios: [{
              title: `QA音频-${marker}`,
              category: '常识',
              type: '晨听',
              duration: '00:00:00',
              fileId: audioFileId,
              sort: Date.now()
            }]
          }),
          callCloud(miniProgram, 'uploadWallpapers', {
            wallpapers: [{
              title: `QA壁纸-${marker}`,
              type: 'default',
              fileId: imageFileId,
              sort: Date.now()
            }]
          })
        ])
        assert.strictEqual(Number(material.code), 0, material.msg || '资料上传失败')
        assert.strictEqual(Number(audio.code), 0, audio.msg || '音频上传失败')
        assert.strictEqual(Number(wallpaper.code), 0, wallpaper.msg || '壁纸上传失败')

        const [materials, audios, wallpapers] = await Promise.all([
          callCloud(miniProgram, 'getMaterials', {}),
          callCloud(miniProgram, 'uploadAudios', { action: 'list' }),
          callCloud(miniProgram, 'uploadWallpapers', { action: 'list' })
        ])
        assert((materials.data || []).some((item) => item._id === documentIds.material), '上传资料未能回读')
        assert((audios.data || []).some((item) => item._id === documentIds.audio), '上传音频未能回读')
        assert((wallpapers.data || []).some((item) => item._id === documentIds.wallpaper), '上传壁纸未能回读')
      } finally {
        if (documentIds.material) removeDocument('materials', { _id: documentIds.material })
        if (documentIds.audio) removeDocument('audios', { _id: documentIds.audio })
        if (documentIds.wallpaper) removeDocument('wallpapers', { _id: documentIds.wallpaper })
        if (fileIds.length) {
          const deleted = await miniProgram.evaluate((files) => new Promise((resolve) => {
            wx.cloud.deleteFile({
              fileList: files,
              success: (result) => resolve({ ok: true, result }),
              fail: (error) => resolve({ ok: false, error: error.errMsg || error.message || String(error) })
            })
          }), fileIds)
          assert(deleted.ok, deleted.error || '临时云文件清理失败')
        }
      }

      const [materialsAfter, audiosAfter, wallpapersAfter] = await Promise.all([
        callCloud(miniProgram, 'getMaterials', {}),
        callCloud(miniProgram, 'uploadAudios', { action: 'list' }),
        callCloud(miniProgram, 'uploadWallpapers', { action: 'list' })
      ])
      assert(!(materialsAfter.data || []).some((item) => item._id === documentIds.material), '临时资料未清理')
      assert(!(audiosAfter.data || []).some((item) => item._id === documentIds.audio), '临时音频未清理')
      assert(!(wallpapersAfter.data || []).some((item) => item._id === documentIds.wallpaper), '临时壁纸未清理')
      return { uploaded: 3, cloudFilesDeleted: fileIds.length, restored: true }
    })

    await test('管理员题库导入、重复拦截与清理', async () => {
      const marker = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`
      const subjectName = `QA科目-${marker}`
      const bankName = `QA题库-${marker}`
      const content = `QA题库导入验收-${marker}`
      const question = {
        subjectName,
        bankName,
        type: 'choice',
        content,
        options: ['选项A', '选项B'],
        correctIndex: 0,
        explanation: '自动验收后删除',
        sort: 1
      }
      try {
        const first = await callCloud(miniProgram, 'uploadQuestions', { questions: [question] })
        assert.strictEqual(Number(first.code), 0, first.msg || '题库导入失败')
        assert.strictEqual(Number(first.data && first.data.insertedCount), 1)
        assert.strictEqual(Number(first.data && first.data.skippedCount), 0)

        const duplicate = await callCloud(miniProgram, 'uploadQuestions', { questions: [question] })
        assert.strictEqual(Number(duplicate.code), 0, duplicate.msg || '题库重复导入检查失败')
        assert.strictEqual(Number(duplicate.data && duplicate.data.insertedCount), 0)
        assert.strictEqual(Number(duplicate.data && duplicate.data.skippedCount), 1)

        const courses = await callCloud(miniProgram, 'getCourses', {})
        const bank = (courses.data || []).find((item) => item.name === bankName)
        assert(bank && bank._id, '新建题库未能回读')
        const questions = await callCloud(miniProgram, 'getQuestions', {
          courseId: bank._id,
          skip: 0,
          limit: 10
        })
        assert((questions.data || []).some((item) => item.content === content), '导入题目未能回读')
      } finally {
        removeDocument('questions', { content })
        removeDocument('question_banks', { name: bankName })
        removeDocument('subjects', { name: subjectName })
      }

      const after = await callCloud(miniProgram, 'getCourses', {})
      assert(!(after.data || []).some((item) => item.name === bankName), '临时题库未清理')
      return { imported: 1, duplicateSkipped: 1, restored: true }
    })

    const failed = results.filter((item) => item.status === 'failed')
    const report = {
      generatedAt: new Date().toISOString(),
      environment: 'production',
      account: { phoneSuffix: expectedPhone.slice(-4), role: currentUser.role || '' },
      reversible: true,
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
