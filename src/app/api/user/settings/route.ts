import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser } from '@/lib/session'
import { readJsonBody } from '@/lib/http'

const VALID_THEMES = ['light', 'dark', 'sepia', 'contrast']
const VALID_FONTS = ['serif', 'sans', 'mono']
const VALID_ALIGN = ['left', 'justify']

export async function GET() {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })
    }

    const settings = await db.userSettings.findUnique({
      where: { userId: user.id },
    })

    if (!settings) {
      // `exists: false` lets the client distinguish "user has no row yet"
      // from "user saved the defaults" — a fresh account should not have its
      // local custom settings clobbered by the server defaults.
      return NextResponse.json({ settings: null, exists: false })
    }

    return NextResponse.json({
      exists: true,
      settings: {
        theme: settings.theme,
        fontFamily: settings.fontFamily,
        fontSize: settings.fontSize,
        lineHeight: settings.lineHeight,
        margin: settings.margin,
        textAlign: settings.textAlign,
        hyphens: settings.hyphens,
        ttsRate: settings.ttsRate,
        ttsVoice: settings.ttsVoice,
        dailyGoalMinutes: settings.dailyGoalMinutes,
      },
    })
  } catch (e) {
    console.error('Get settings error', e)
    return NextResponse.json(
      { error: 'Внутренняя ошибка сервера' },
      { status: 500 },
    )
  }
}

export async function PUT(req: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })
    }

    const body = await readJsonBody<{
      theme?: unknown, fontFamily?: unknown, fontSize?: unknown, lineHeight?: unknown, margin?: unknown,
      textAlign?: unknown, hyphens?: unknown, ttsRate?: unknown, ttsVoice?: unknown, dailyGoalMinutes?: unknown,
    }>(req, 64 * 1024)
    const {
      theme, fontFamily, fontSize, lineHeight, margin,
      textAlign, hyphens, ttsRate, ttsVoice, dailyGoalMinutes,
    } = body ?? {}

    // Validate
    const data: Record<string, unknown> = {}
    if (theme !== undefined) {
      if (typeof theme !== 'string' || !VALID_THEMES.includes(theme)) {
        return NextResponse.json({ error: 'Некорректная тема' }, { status: 400 })
      }
      data.theme = theme
    }
    if (fontFamily !== undefined) {
      if (typeof fontFamily !== 'string' || !VALID_FONTS.includes(fontFamily)) {
        return NextResponse.json({ error: 'Некорректный шрифт' }, { status: 400 })
      }
      data.fontFamily = fontFamily
    }
    if (fontSize !== undefined) {
      const n = Number(fontSize)
      if (!Number.isFinite(n) || n < 12 || n > 28) {
        return NextResponse.json({ error: 'Размер шрифта 12-28' }, { status: 400 })
      }
      data.fontSize = n
    }
    if (lineHeight !== undefined) {
      const n = Number(lineHeight)
      if (!Number.isFinite(n) || n < 1.2 || n > 2.4) {
        return NextResponse.json({ error: 'Межстрочный 1.2-2.4' }, { status: 400 })
      }
      data.lineHeight = n
    }
    if (margin !== undefined) {
      const n = Number(margin)
      if (!Number.isFinite(n) || n < 1 || n > 6) {
        return NextResponse.json({ error: 'Поля 1-6' }, { status: 400 })
      }
      data.margin = n
    }
    if (textAlign !== undefined) {
      if (typeof textAlign !== 'string' || !VALID_ALIGN.includes(textAlign)) {
        return NextResponse.json({ error: 'Выравнивание: left/justify' }, { status: 400 })
      }
      data.textAlign = textAlign
    }
    if (hyphens !== undefined) {
      if (typeof hyphens !== 'boolean') {
        return NextResponse.json({ error: 'hyphens: true/false' }, { status: 400 })
      }
      data.hyphens = hyphens
    }
    if (ttsRate !== undefined) {
      const n = Number(ttsRate)
      if (!Number.isFinite(n) || n < 0.5 || n > 2.0) {
        return NextResponse.json({ error: 'TTS скорость 0.5-2.0' }, { status: 400 })
      }
      data.ttsRate = n
    }
    if (ttsVoice !== undefined) {
      data.ttsVoice = ttsVoice === null ? null : String(ttsVoice).slice(0, 300)
    }
    if (dailyGoalMinutes !== undefined) {
      const n = Number(dailyGoalMinutes)
      if (!Number.isFinite(n) || n < 5 || n > 240) {
        return NextResponse.json({ error: 'Цель 5-240 мин' }, { status: 400 })
      }
      data.dailyGoalMinutes = n
    }

    const updated = await db.userSettings.upsert({
      where: { userId: user.id },
      create: { userId: user.id, ...data },
      update: data,
    })

    return NextResponse.json({
      settings: {
        theme: updated.theme,
        fontFamily: updated.fontFamily,
        fontSize: updated.fontSize,
        lineHeight: updated.lineHeight,
        margin: updated.margin,
        textAlign: updated.textAlign,
        hyphens: updated.hyphens,
        ttsRate: updated.ttsRate,
        ttsVoice: updated.ttsVoice,
        dailyGoalMinutes: updated.dailyGoalMinutes,
      },
    })
  } catch (e) {
    console.error('Update settings error', e)
    return NextResponse.json(
      { error: 'Внутренняя ошибка сервера' },
      { status: 500 },
    )
  }
}
