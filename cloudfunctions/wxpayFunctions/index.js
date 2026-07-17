const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

exports.main = async () => ({
  code: -1,
  msg: '原支付能力已停用，请使用官方小程序虚拟支付'
})
