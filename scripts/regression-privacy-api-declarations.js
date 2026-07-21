const assert = require('assert')
const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')

function listFiles(directory, output = []) {
  for (const name of fs.readdirSync(directory)) {
    const fullPath = path.join(directory, name)
    const stat = fs.statSync(fullPath)
    if (stat.isDirectory()) listFiles(fullPath, output)
    else if (/\.(js|wxml)$/.test(name)) output.push(fullPath)
  }
  return output
}

function main() {
  const runtime = listFiles(path.join(root, 'pages'))
    .concat(listFiles(path.join(root, 'utils')))
    .map((filePath) => fs.readFileSync(filePath, 'utf8'))
    .join('\n')
  const privacyPolicy = fs.readFileSync(path.join(root, 'pages/privacy/privacy.wxml'), 'utf8')

  assert(runtime.includes('open-type="getPhoneNumber"'), 'phone authorization entry must exist')
  assert(runtime.includes('wx.chooseMedia'), 'selected photo/video entry must exist')
  assert(runtime.includes('wx.chooseMessageFile'), 'selected file entry must exist')
  assert(runtime.includes('saveImageWithPermission'), 'album writes must use the recoverable permission helper')
  assert(!runtime.includes('wx.getClipboardData'), 'the app must not read clipboard content without a declared requirement')

  assert(privacyPolicy.includes('用户授权的手机号'), 'privacy policy must disclose phone processing')
  assert(privacyPolicy.includes('用户主动选择的照片、视频和文件'), 'privacy policy must disclose selected media and files')
  assert(privacyPolicy.includes('相册“仅写入”权限'), 'privacy policy must disclose album write access')
  assert(privacyPolicy.includes('不读取剪贴板内容'), 'privacy policy must accurately describe clipboard behavior')

  console.log('privacy API declaration regression checks passed')
}

main()
