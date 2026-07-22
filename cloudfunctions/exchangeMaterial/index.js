const cloud = require('wx-server-sdk')
const crypto = require('crypto')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const MATERIAL_COST = 10

function stableId(prefix, openid, materialId) {
  const hash = crypto.createHash('sha256').update(`${openid}:${materialId}`).digest('hex')
  return `${prefix}_${hash.slice(0, 32)}`
}

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext()
  const materialId = event.materialId
  if (!OPENID) return { code: -1, msg: '请先登录' }
  if (!materialId) return { code: -1, msg: '缺少资料参数' }

  try {
    const [materialRes, userRes, legacyRedemptionRes] = await Promise.all([
      db.collection('materials').doc(materialId).get(),
      db.collection('users').where({ _openid: OPENID }).limit(1).get(),
      db.collection('material_redemptions')
        .where({ _openid: OPENID, materialId })
        .limit(1)
        .get()
        .catch(() => ({ data: [] }))
    ])
    const material = materialRes.data
    const user = userRes.data[0]
    if (!material || material.enabled === false) return { code: -1, msg: '资料不存在或已下架' }
    if (!user) return { code: -1, msg: '请先登录' }
    if (legacyRedemptionRes.data.length) {
      return {
        code: 0,
        msg: '资料已兑换',
        data: { alreadyOwned: true, remainingCoins: Number(user.coins || 0), material }
      }
    }

    const redemptionId = stableId('material', OPENID, materialId)
    const logId = stableId('material_log', OPENID, materialId)
    const result = await db.runTransaction(async (transaction) => {
      const latestUserRes = await transaction.collection('users').doc(user._id).get()
      const latestUser = latestUserRes.data
      if (!latestUser) throw new Error('用户不存在')

      let existingRedemption = null
      try {
        const existingRes = await transaction.collection('material_redemptions').doc(redemptionId).get()
        existingRedemption = existingRes.data || null
      } catch (err) {}
      if (existingRedemption) {
        return { alreadyOwned: true, remainingCoins: Number(latestUser.coins || 0), material }
      }

      if (Number(latestUser.coins || 0) < MATERIAL_COST) {
        const err = new Error('舟币不足，请先完成任务赚取舟币')
        err.businessCode = 2
        throw err
      }

      await transaction.collection('users').doc(latestUser._id).update({
        data: { coins: Number(latestUser.coins || 0) - MATERIAL_COST }
      })
      await transaction.collection('coin_logs').doc(logId).set({
        data: {
          _openid: OPENID,
          type: 'material_exchange',
          title: `兑换资料：${material.name || '未命名资料'}`,
          amount: -MATERIAL_COST,
          materialId,
          createdAt: db.serverDate()
        }
      })
      await transaction.collection('material_redemptions').doc(redemptionId).set({
        data: {
          _openid: OPENID,
          materialId,
          materialName: material.name || '',
          accessType: 'coin',
          cost: MATERIAL_COST,
          createdAt: db.serverDate()
        }
      })
      return {
        alreadyOwned: false,
        remainingCoins: Number(latestUser.coins || 0) - MATERIAL_COST,
        material
      }
    })

    return { code: 0, msg: result.alreadyOwned ? '资料已兑换' : '兑换成功', data: result }
  } catch (err) {
    if (err && err.businessCode) return { code: err.businessCode, msg: err.message }
    console.error('[exchangeMaterial] failed', err)
    return { code: -1, msg: err.message || '资料领取失败' }
  }
}
