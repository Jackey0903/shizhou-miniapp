const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'))
const requiredPages = [
  'pages/admin-center/admin-center',
  'pages/admin-role-manager/admin-role-manager',
  'pages/user-access-admin/user-access-admin',
  'pages/miniapp-code/miniapp-code',
  'pages/course-upload/course-upload',
  'pages/audio-upload/audio-upload',
  'pages/material-upload/material-upload',
  'pages/wallpaper-upload/wallpaper-upload'
]

const failures = []
requiredPages.forEach((page) => {
  if (!app.pages.includes(page)) failures.push(`${page} 未注册到 app.json`)
  ;['js', 'json', 'wxml', 'wxss'].forEach((extension) => {
    const file = path.join(root, `${page}.${extension}`)
    if (!fs.existsSync(file)) failures.push(`${page}.${extension} 不存在`)
  })

  const jsFile = path.join(root, `${page}.js`)
  const wxmlFile = path.join(root, `${page}.wxml`)
  if (!fs.existsSync(jsFile) || !fs.existsSync(wxmlFile)) return
  const js = fs.readFileSync(jsFile, 'utf8')
  const wxml = fs.readFileSync(wxmlFile, 'utf8')
  const handlers = new Set()
  const pattern = /\b(?:bind|catch)[a-z]+="([A-Za-z_$][\w$]*)"/g
  let match
  while ((match = pattern.exec(wxml))) handlers.add(match[1])
  handlers.forEach((handler) => {
    if (!new RegExp(`\\b${handler}\\s*\\(`).test(js)) {
      failures.push(`${page}.wxml 绑定了缺失的方法 ${handler}`)
    }
  })
})

const cloudApi = fs.readFileSync(path.join(root, 'utils/cloudApi.js'), 'utf8')
;[
  'getAdminCourseTree',
  'saveAdminSubject',
  'saveAdminQuestionBank',
  'listAdminContent',
  'toggleAdminContent',
  'searchAdminUsers',
  'getAdminUsers',
  'getAdminIdentity',
  'getAdministrators',
  'setAdministrator',
  'transferSuperAdministrator',
  'grantAdminUserAccess',
  'getAdminMiniProgramCode',
  'generateAdminMiniProgramCode'
].forEach((name) => {
  if (!new RegExp(`\\b${name}\\b`).test(cloudApi)) failures.push(`cloudApi 缺少 ${name}`)
})

const adminFunction = path.join(root, 'cloudfunctions/adminOperations/index.js')
if (!fs.existsSync(adminFunction)) failures.push('adminOperations 云函数不存在')
if (fs.existsSync(adminFunction)) {
  const source = fs.readFileSync(adminFunction, 'utf8')
  ;[
    'bootstrapSuperAdmin',
    'listUsers',
    'setAdministrator',
    'transferSuperAdmin',
    'isSuperAdminUser(admin)'
  ].forEach((contract) => {
    if (!source.includes(contract)) failures.push(`adminOperations 缺少最高管理员约束：${contract}`)
  })
}
const cloudbase = JSON.parse(fs.readFileSync(path.join(root, 'cloudbaserc.json'), 'utf8'))
if (!(cloudbase.functions || []).some((item) => item.name === 'adminOperations')) {
  failures.push('cloudbaserc.json 未登记 adminOperations')
}

if (failures.length) {
  console.error(failures.map((item) => `- ${item}`).join('\n'))
  process.exit(1)
}

console.log(`管理员工作台结构校验通过：${requiredPages.length} 个页面`)
