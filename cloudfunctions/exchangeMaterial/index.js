const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command
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

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const materialId = event.materialId

  if (!materialId) {
    return { code: -1, msg: '缺少资料参数' }
  }

  try {
    const [materialRes, userRes, redemptionRes] = await Promise.all([
      db.collection('materials').doc(materialId).get(),
      db.collection('users').where({ _openid: OPENID }).limit(1).get(),
      db.collection('material_redemptions').where({ _openid: OPENID, materialId }).limit(1).get().catch(() => ({ data: [] }))
    ])

    const material = materialRes.data
    const user = (userRes.data || [])[0]
    if (!material) return { code: -1, msg: '资料不存在' }
    if (!user) return { code: -1, msg: '请先登录' }

    const redeemed = (redemptionRes.data || [])[0]
    const accessType = normalizeAccessType(material.accessType)
    const cost = accessType === 'coin' ? getCoinCost(material) : 0

    if (redeemed) {
      return {
        code: 0,
        msg: '资料已兑换',
        data: {
          alreadyOwned: true,
          remainingCoins: user.coins || 0,
          material
        }
      }
    }

    if (accessType === 'vip' && !isVipActive(user)) {
      return { code: 3, msg: '该资料为VIP免费领取，请先开通VIP' }
    }

    if ((user.coins || 0) < cost) {
      return { code: 2, msg: '舟币不足，请先完成任务赚取舟币' }
    }

    if (cost > 0) {
      await db.collection('users').doc(user._id).update({
        data: { coins: _.inc(-cost) }
      })

      await db.collection('coin_logs').add({
        data: {
          _openid: OPENID,
          type: 'material_exchange',
          title: `兑换资料：${material.name || '未命名资料'}`,
          amount: -cost,
          createdAt: db.serverDate()
        }
      })
    }

    await db.collection('material_redemptions').add({
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
      code: 0,
      msg: '兑换成功',
      data: {
        alreadyOwned: false,
        remainingCoins: Math.max(0, (user.coins || 0) - cost),
        material
      }
    }
  } catch (err) {
    return { code: -1, msg: err.message }
  }
}
