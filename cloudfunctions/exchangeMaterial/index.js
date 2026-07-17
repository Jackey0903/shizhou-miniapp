const cloud = require('wx-server-sdk')
const crypto = require('crypto')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const MATERIAL_COST = 5

function normalizeAccessType(value) {
  return ['free', 'vip', 'coin'].includes(value) ? value : 'coin'
}

function getCoinCost(material) {
  const cost = Number(material.coinCost)
  return Number.isFinite(cost) && cost > 0 ? Math.floor(cost) : MATERIAL_COST
}

function isVipActive(user) {
  if (!user || !user.isVip) return false
  if (!user.vipExpireDate) return true
  return new Date(user.vipExpireDate).getTime() > Date.now()
}

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
      let existingRedemption = null
      try {
        const existingRes = await transaction.collection('material_redemptions').doc(redemptionId).get()
        existingRedemption = existingRes.data || null
      } catch (err) {}
      if (existingRedemption) {
        return { alreadyOwned: true, remainingCoins: Number(user.coins || 0), material }
      }

      const latestUserRes = await transaction.collection('users').doc(user._id).get()
      const latestUser = latestUserRes.data
      if (!latestUser) throw new Error('用户不存在')
      const accessType = normalizeAccessType(material.accessType)
      const cost = accessType === 'coin' ? getCoinCost(material) : 0
      if (accessType === 'vip' && !isVipActive(latestUser)) {
        const err = new Error('该资料为VIP免费领取，请先开通VIP')
        err.businessCode = 3
        throw err
      }
      if (Number(latestUser.coins || 0) < cost) {
        const err = new Error('舟币不足，请先完成任务赚取舟币')
        err.businessCode = 2
        throw err
      }

      if (cost > 0) {
        await transaction.collection('users').doc(latestUser._id).update({
          data: { coins: Number(latestUser.coins || 0) - cost }
        })
        await transaction.collection('coin_logs').doc(logId).set({
          data: {
            _openid: OPENID,
            type: 'material_exchange',
            title: `兑换资料：${material.name || '未命名资料'}`,
            amount: -cost,
            materialId,
            createdAt: db.serverDate()
          }
        })
      }
      await transaction.collection('material_redemptions').doc(redemptionId).set({
        data: {
          _openid: OPENID,
          materialId,
          materialName: material.name || '',
          accessType,
          cost,
          createdAt: db.serverDate()
        }
      })
      return {
        alreadyOwned: false,
        remainingCoins: Number(latestUser.coins || 0) - cost,
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
