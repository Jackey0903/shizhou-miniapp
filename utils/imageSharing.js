const PRIVACY_DENIED_PATTERN = /privacy permission is not authorized|privacy authorization|未同意隐私|errno[^0-9]*(103|104)/i
const PRIVACY_CONFIG_PATTERN = /scope is not declared|privacy api banned|errno[^0-9]*112/i
const ALBUM_DENIED_PATTERN = /auth deny|authorize:fail|scope\.writePhotosAlbum|permission[^\n]*(denied|deny)|没有相册权限|相册权限/i
const CANCEL_PATTERN = /\bcancel(?:led)?\b|用户取消/i

function getErrorMessage(error) {
  if (!error) return ''
  return String(error.errMsg || error.message || error)
}

function callApi(api, context, options = {}) {
  return new Promise((resolve, reject) => {
    if (typeof api !== 'function') {
      reject(new Error('当前微信版本不支持此功能'))
      return
    }
    try {
      api.call(context, {
        ...options,
        success: resolve,
        fail: reject
      })
    } catch (error) {
      reject(error)
    }
  })
}

function isCancelError(error) {
  return CANCEL_PATTERN.test(getErrorMessage(error))
}

function isPrivacyPermissionError(error) {
  const message = getErrorMessage(error)
  return PRIVACY_DENIED_PATTERN.test(message) || Number(error && error.errno) === 103 || Number(error && error.errno) === 104
}

function isPrivacyConfigurationError(error) {
  const message = getErrorMessage(error)
  return PRIVACY_CONFIG_PATTERN.test(message) || Number(error && error.errno) === 112
}

function isAlbumPermissionError(error) {
  return ALBUM_DENIED_PATTERN.test(getErrorMessage(error))
}

async function getPrivacyState(wxApi) {
  if (!wxApi || typeof wxApi.getPrivacySetting !== 'function') {
    return { needAuthorization: false, privacyContractName: '' }
  }
  try {
    const result = await callApi(wxApi.getPrivacySetting, wxApi)
    return {
      needAuthorization: !!result.needAuthorization,
      privacyContractName: result.privacyContractName || ''
    }
  } catch (error) {
    // Let the real privacy API trigger WeChat's official fallback dialog.
    return { needAuthorization: false, privacyContractName: '' }
  }
}

async function getAlbumAuthorization(wxApi) {
  if (!wxApi || typeof wxApi.getSetting !== 'function') return undefined
  try {
    const result = await callApi(wxApi.getSetting, wxApi)
    const authSetting = result.authSetting || {}
    return authSetting['scope.writePhotosAlbum']
  } catch (error) {
    return undefined
  }
}

async function getImageInfoWithPackageFallback(filePath, options = {}) {
  const wxApi = options.wxApi || wx
  try {
    return await callApi(wxApi.getImageInfo, wxApi, { src: filePath })
  } catch (error) {
    const width = Number(options.packageWidth)
    const height = Number(options.packageHeight)
    const isPackageImage = typeof filePath === 'string' && filePath.startsWith('/')
    if (!isPackageImage || !Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
      throw error
    }
    return { path: filePath, width, height, packageFallback: true }
  }
}

async function recoverAlbumPermission(wxApi, options = {}) {
  const permission = await getAlbumAuthorization(wxApi)
  if (permission === true) {
    if (typeof wxApi.showModal === 'function') {
      await callApi(wxApi.showModal, wxApi, {
        title: '请开启系统照片权限',
        content: options.systemPermissionMessage || '小程序权限已开启，请到手机系统设置中允许微信访问照片和视频，然后返回重试。',
        showCancel: false
      }).catch(() => null)
    }
    return false
  }

  if (typeof wxApi.showModal !== 'function') return false
  const modalResult = await callApi(wxApi.showModal, wxApi, {
    title: '需要相册写入权限',
    content: options.albumPermissionMessage || '保存图片需要“添加到相册”权限。请在设置中开启，返回后将自动继续保存。',
    confirmText: '去设置'
  }).catch(() => ({ confirm: false }))
  if (!modalResult.confirm || typeof wxApi.openSetting !== 'function') return false

  const settingResult = await callApi(wxApi.openSetting, wxApi).catch(() => null)
  return !!(settingResult && settingResult.authSetting && settingResult.authSetting['scope.writePhotosAlbum'])
}

async function requestPrivacyConsent(filePath, options) {
  if (typeof options.onPrivacyRequired === 'function') {
    const state = await getPrivacyState(options.wxApi)
    options.onPrivacyRequired(filePath, state.privacyContractName)
  }
  return { status: 'privacy-required' }
}

async function saveImageWithPermission(filePath, options = {}) {
  const wxApi = options.wxApi || wx
  const privacyState = await getPrivacyState(wxApi)
  if (privacyState.needAuthorization) {
    if (typeof options.onPrivacyRequired === 'function') {
      options.onPrivacyRequired(filePath, privacyState.privacyContractName)
    }
    return { status: 'privacy-required' }
  }

  try {
    await callApi(wxApi.saveImageToPhotosAlbum, wxApi, { filePath })
    return { status: 'saved' }
  } catch (error) {
    if (isCancelError(error)) return { status: 'cancelled' }
    if (isPrivacyConfigurationError(error)) {
      const configError = new Error('相册写入尚未在小程序隐私保护指引中生效')
      configError.code = 'PRIVACY_SCOPE_NOT_DECLARED'
      configError.cause = error
      throw configError
    }
    if (isPrivacyPermissionError(error)) {
      return requestPrivacyConsent(filePath, { ...options, wxApi })
    }
    if (!isAlbumPermissionError(error) || typeof options.recoverAlbumPermission !== 'function') {
      throw error
    }

    const recovered = await options.recoverAlbumPermission(error)
    if (!recovered) return { status: 'permission-denied' }

    try {
      await callApi(wxApi.saveImageToPhotosAlbum, wxApi, { filePath })
      return { status: 'saved' }
    } catch (retryError) {
      if (isCancelError(retryError)) return { status: 'cancelled' }
      throw retryError
    }
  }
}

async function shareImageWithFallback(filePath, options = {}) {
  const wxApi = options.wxApi || wx
  if (!options.skipShareMenu && typeof wxApi.showShareImageMenu === 'function') {
    try {
      await callApi(wxApi.showShareImageMenu, wxApi, {
        path: filePath,
        needShowEntrance: false
      })
      return { status: 'shared' }
    } catch (error) {
      if (isCancelError(error)) return { status: 'cancelled' }
    }
  }

  return saveImageWithPermission(filePath, { ...options, wxApi })
}

module.exports = {
  getAlbumAuthorization,
  getErrorMessage,
  getImageInfoWithPackageFallback,
  isAlbumPermissionError,
  isCancelError,
  isPrivacyConfigurationError,
  isPrivacyPermissionError,
  recoverAlbumPermission,
  saveImageWithPermission,
  shareImageWithFallback
}
