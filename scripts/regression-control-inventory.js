const assert = require('assert')
const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'))
const registeredPages = new Set(app.pages)
const interactiveTags = new Set([
  'button', 'navigator', 'input', 'textarea', 'picker', 'slider', 'switch',
  'checkbox-group', 'radio-group', 'form'
])

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

function extractMethodBody(source, handler) {
  const escaped = handler.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const startPattern = new RegExp(`(?:^|[,{\\s])(?:async\\s+)?${escaped}\\s*\\([^)]*\\)\\s*\\{`, 'm')
  const match = startPattern.exec(source)
  if (!match) return null
  const braceStart = source.indexOf('{', match.index + match[0].length - 1)
  let depth = 0
  let quote = ''
  let escapedChar = false
  for (let index = braceStart; index < source.length; index += 1) {
    const char = source[index]
    if (quote) {
      if (escapedChar) escapedChar = false
      else if (char === '\\') escapedChar = true
      else if (char === quote) quote = ''
      continue
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char
      continue
    }
    if (char === '{') depth += 1
    if (char === '}') {
      depth -= 1
      if (depth === 0) return source.slice(braceStart + 1, index).trim()
    }
  }
  return null
}

function main() {
  const controls = []
  const unboundControls = []
  const invalidRoutes = []
  const missingHandlers = []
  const emptyHandlers = []
  const allowedEmptyHandlers = new Set(['noop', 'onAdLoad'])
  const pageSummary = []

  for (const page of app.pages) {
    const wxml = read(`${page}.wxml`)
    const js = read(`${page}.js`)
    const pageControls = []
    const tagPattern = /<([\w-]+)\b([^>]*)>/g
    let tagMatch = null
    while ((tagMatch = tagPattern.exec(wxml))) {
      const tag = tagMatch[1]
      const attrs = tagMatch[2]
      const events = [...attrs.matchAll(/((?:bind|catch)(?::|-)?[\w-]+)\s*=\s*["']([A-Za-z_$][\w$]*)["']/g)]
        .map((match) => ({ type: match[1], handler: match[2] }))
      const url = (attrs.match(/\burl\s*=\s*["']([^"']+)["']/) || [])[1] || ''
      const openType = (attrs.match(/\bopen-type\s*=\s*["']([^"']+)["']/) || [])[1] || ''
      const hasInteraction = interactiveTags.has(tag) || events.length > 0 || !!url || !!openType
      if (!hasInteraction) continue

      const control = { page, tag, events, url, openType }
      controls.push(control)
      pageControls.push(control)

      if (interactiveTags.has(tag) && !events.length && !url && !openType) {
        // Disabled display-only form controls are still invalid because users cannot operate them.
        if (!/\bdisabled\s*=/.test(attrs)) unboundControls.push(`${page}: <${tag}>`)
      }

      if (url && url.startsWith('/pages/')) {
        const route = url.split('?')[0].slice(1)
        if (!registeredPages.has(route)) invalidRoutes.push(`${page}: ${url}`)
      }

      for (const event of events) {
        const body = extractMethodBody(js, event.handler)
        if (body === null) missingHandlers.push(`${page}: ${event.type}=${event.handler}`)
        else if (!body.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '').trim() && !allowedEmptyHandlers.has(event.handler)) {
          emptyHandlers.push(`${page}: ${event.handler}`)
        }
      }
    }
    pageSummary.push({ page, controls: pageControls.length })
  }

  assert.deepStrictEqual(unboundControls, [], `Interactive controls without behavior:\n${unboundControls.join('\n')}`)
  assert.deepStrictEqual(invalidRoutes, [], `Controls point to unregistered pages:\n${invalidRoutes.join('\n')}`)
  assert.deepStrictEqual(missingHandlers, [], `Control handlers missing:\n${missingHandlers.join('\n')}`)
  assert.deepStrictEqual(emptyHandlers, [], `Control handlers empty:\n${emptyHandlers.join('\n')}`)

  const eventBindings = controls.reduce((sum, item) => sum + item.events.length, 0)
  const buttons = controls.filter((item) => item.tag === 'button').length
  const navigators = controls.filter((item) => item.tag === 'navigator').length
  const inputControls = controls.filter((item) => ['input', 'textarea', 'picker', 'slider', 'switch', 'checkbox-group', 'radio-group'].includes(item.tag)).length
  assert(buttons > 0 && navigators > 0 && inputControls > 0)
  console.log(JSON.stringify({
    ok: true,
    pages: app.pages.length,
    interactiveControls: controls.length,
    eventBindings,
    buttons,
    navigators,
    inputControls,
    pageSummary
  }, null, 2))
}

main()
