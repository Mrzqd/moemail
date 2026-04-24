import { auth } from "@/lib/auth"
import { NextResponse } from "next/server"
import { i18n, type Locale } from "@/i18n/config"
import { PERMISSIONS } from "@/lib/permissions"
import { checkPermissionForUser } from "@/lib/auth"
import { Permission } from "@/lib/permissions"
import { handleApiKeyAuth } from "@/lib/apiKey"

const API_PERMISSIONS: Record<string, Permission> = {
  '/api/emails': PERMISSIONS.MANAGE_EMAIL,
  '/api/webhook': PERMISSIONS.MANAGE_WEBHOOK,
  '/api/roles/promote': PERMISSIONS.PROMOTE_USER,
  '/api/config': PERMISSIONS.MANAGE_CONFIG,
  '/api/api-keys': PERMISSIONS.MANAGE_API_KEY,
}

export async function middleware(request: Request) {
  const middlewareStartedAt = Date.now()
  const middlewareTimings: string[] = []
  const markMiddleware = (name: string, from: number) => {
    middlewareTimings.push(`${name};dur=${Date.now() - from}`)
    return Date.now()
  }

  const url = new URL(request.url)
  const pathname = url.pathname

  if (pathname.startsWith('/api')) {
    if (pathname.startsWith('/api/auth')) {
      return NextResponse.next()
    }

    request.headers.delete("X-User-Id")
    const apiKey = request.headers.get("X-API-Key")
    if (apiKey) {
      if (pathname.startsWith('/api/config') && (pathname !== '/api/config' || request.method !== 'GET')) {
        return NextResponse.json(
          { error: "无权限查看" },
          { status: 403 }
        )
      }
      return handleApiKeyAuth(apiKey, pathname)
    }

    if (pathname === '/api/config' && request.method === 'GET') {
      return NextResponse.next()
    }

    const authStartedAt = Date.now()
    const session = await auth()
    markMiddleware('mw-auth', authStartedAt)
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "未授权" },
        { status: 401 }
      )
    }

    const requestHeaders = new Headers(request.headers)
    requestHeaders.set("X-User-Id", session.user.id)

    // These GET endpoints already enforce ownership / send capability in their route handlers.
    // Avoid a duplicated role lookup in middleware for the hot polling path.
    const isEmailReadPath = request.method === 'GET' && (
      pathname === '/api/emails' ||
      /^\/api\/emails\/[^/]+$/.test(pathname) ||
      pathname === '/api/emails/send-permission'
    )
    if (isEmailReadPath) {
      requestHeaders.set("X-Middleware-Timing", [...middlewareTimings, `mw-total;dur=${Date.now() - middlewareStartedAt}`].join(', '))
      return NextResponse.next({ request: { headers: requestHeaders } })
    }

    for (const [route, permission] of Object.entries(API_PERMISSIONS)) {
      if (pathname.startsWith(route)) {
        const permissionStartedAt = Date.now()
        const hasAccess = await checkPermissionForUser(session.user.id, permission)
        middlewareTimings.push(`mw-permission;dur=${Date.now() - permissionStartedAt}`)

        if (!hasAccess) {
          return NextResponse.json(
            { error: "权限不足" },
            { status: 403 }
          )
        }
        break
      }
    }
    requestHeaders.set("X-Middleware-Timing", [...middlewareTimings, `mw-total;dur=${Date.now() - middlewareStartedAt}`].join(', '))
    return NextResponse.next({ request: { headers: requestHeaders } })
  }

  // Pages: 语言前缀
  const segments = pathname.split('/')
  const maybeLocale = segments[1]
  const hasLocalePrefix = i18n.locales.includes(maybeLocale as any)
  if (!hasLocalePrefix) {
    const cookieLocale = request.headers.get('Cookie')?.match(/NEXT_LOCALE=([^;]+)/)?.[1]
    const acceptLanguage = request.headers.get('Accept-Language')
    const preferredLocale = resolvePreferredLocale(cookieLocale, acceptLanguage)
    const targetLocale = preferredLocale ?? i18n.defaultLocale
    const redirectURL = new URL(`/${targetLocale}${pathname}${url.search}`, request.url)
    return NextResponse.redirect(redirectURL)
  }

  return NextResponse.next()
}

function resolvePreferredLocale(cookieLocale: string | undefined, acceptLanguageHeader: string | null): Locale | null {
  if (cookieLocale && i18n.locales.includes(cookieLocale as Locale)) {
    return cookieLocale as Locale
  }

  if (!acceptLanguageHeader) return null

  const candidates = parseAcceptLanguage(acceptLanguageHeader)
  for (const lang of candidates) {
    const match = matchLocale(lang)
    if (match) {
      return match
    }
  }

  return null
}

function parseAcceptLanguage(header: string): string[] {
  return header
    .split(',')
    .map((part) => {
      const [lang, ...params] = part.trim().split(';')
      const qualityParam = params.find((param) => param.trim().startsWith('q='))
      const quality = qualityParam ? parseFloat(qualityParam.split('=')[1]) : 1
      return { lang: lang.toLowerCase(), quality: isNaN(quality) ? 1 : quality }
    })
    .sort((a, b) => b.quality - a.quality)
    .map((entry) => entry.lang)
}

function matchLocale(lang: string): Locale | null {
  const exactMatch = i18n.locales.find((locale) => locale.toLowerCase() === lang)
  if (exactMatch) return exactMatch

  const base = lang.split('-')[0]

  // Handle Chinese variants with explicit regions or scripts
  if (base === 'zh') {
    if (lang.includes('tw') || lang.includes('hk') || lang.includes('mo') || lang.includes('hant')) {
      return 'zh-TW'
    }
    if (lang.includes('cn') || lang.includes('sg') || lang.includes('hans')) {
      return 'zh-CN'
    }
    // default Chinese fallback
    return 'zh-CN'
  }

  const baseMatch = i18n.locales.find((locale) => locale.toLowerCase().split('-')[0] === base)
  if (baseMatch) return baseMatch

  return null
}

export const config = {
  matcher: [
    '/((?!_next|.*\\..*).*)', // all pages excluding static assets
    '/api/emails/:path*',
    '/api/webhook/:path*',
    '/api/roles/:path*',
    '/api/config/:path*',
    '/api/api-keys/:path*',
  ]
} 
