const test = require('node:test')
const assert = require('node:assert/strict')
const {
  PLAN_GRANTS,
  CONTENT_TARGETS,
  text,
  integer,
  normalizeColor,
  isEnabled,
  addDaysFromCurrent,
  publicUser,
  normalizeBinaryResponse
} = require('../cloudfunctions/adminOperations/adminCore')

test('manual grant plans match the four production plans', () => {
  assert.deepEqual(Object.keys(PLAN_GRANTS), [
    'basic_vip_year',
    'supervision_trial_day',
    'supervision_month',
    'premium_vip_year'
  ])
  assert.deepEqual(PLAN_GRANTS.basic_vip_year, {
    label: '基础VIP包年',
    vipDays: 365,
    supervisionDays: 0
  })
  assert.equal(PLAN_GRANTS.supervision_trial_day.supervisionDays, 1)
  assert.equal(PLAN_GRANTS.supervision_month.supervisionDays, 30)
  assert.equal(PLAN_GRANTS.premium_vip_year.supervisionDays, 365)
})

test('text and integer normalizers enforce bounds', () => {
  assert.equal(text('  abc  ', 2), 'ab')
  assert.equal(integer('12', 0, 0, 10), 10)
  assert.equal(integer('bad', 7, 0, 10), 7)
})

test('colors only accept full six digit hex values', () => {
  assert.equal(normalizeColor('#2563eb'), '#2563EB')
  assert.equal(normalizeColor('#fff'), '')
  assert.equal(normalizeColor('blue'), '')
})

test('content enabled state follows each collection schema', () => {
  assert.equal(CONTENT_TARGETS.materials.enabledField, 'enabled')
  assert.equal(isEnabled({ enabled: true }, 'materials'), true)
  assert.equal(isEnabled({ enabled: false }, 'materials'), false)
  assert.equal(isEnabled({ status: 'enabled' }, 'subjects'), true)
  assert.equal(isEnabled({ status: 'disabled' }, 'subjects'), false)
  assert.equal(isEnabled({ status: 'offline' }, 'question_banks'), false)
})

test('grant expiry extends active access and restarts expired access', () => {
  const now = new Date('2026-07-25T00:00:00.000Z')
  assert.equal(
    addDaysFromCurrent('2026-08-01T00:00:00.000Z', 30, now).toISOString(),
    '2026-08-31T00:00:00.000Z'
  )
  assert.equal(
    addDaysFromCurrent('2026-07-01T00:00:00.000Z', 1, now).toISOString(),
    '2026-07-26T00:00:00.000Z'
  )
})

test('admin user search response excludes openid, token and secrets', () => {
  const safe = publicUser({
    _id: 'user-1',
    _openid: 'openid-secret',
    token: 'token-secret',
    nickName: '测试用户',
    phone: '13800138000',
    coins: 12
  })
  assert.equal(safe._id, 'user-1')
  assert.equal(safe.phone, '13800138000')
  assert.equal(safe.coins, 12)
  assert.equal(Object.hasOwn(safe, '_openid'), false)
  assert.equal(Object.hasOwn(safe, 'token'), false)
})

test('mini program code responses accept common cloud SDK binary types', () => {
  const buffer = Buffer.from([1, 2, 3])
  assert.deepEqual(normalizeBinaryResponse({ buffer }), buffer)
  assert.deepEqual(normalizeBinaryResponse({ data: new Uint8Array([4, 5]) }), Buffer.from([4, 5]))
  assert.deepEqual(normalizeBinaryResponse(new Uint8Array([6, 7]).buffer), Buffer.from([6, 7]))
  assert.equal(normalizeBinaryResponse({ errCode: 1 }), null)
})
