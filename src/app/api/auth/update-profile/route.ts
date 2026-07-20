import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser } from '@/lib/session'

export async function PATCH(req: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json(
        { error: 'Не авторизован' },
        { status: 401 },
      )
    }

    const body = await req.json().catch(() => ({}))
    const { name } = body ?? {}

    if (typeof name !== 'string' && name !== null) {
      return NextResponse.json(
        { error: 'Имя должно быть строкой' },
        { status: 400 },
      )
    }

    const trimmedName = name?.trim() || null
    if (trimmedName && trimmedName.length > 100) {
      return NextResponse.json(
        { error: 'Имя слишком длинное' },
        { status: 400 },
      )
    }

    const updated = await db.user.update({
      where: { id: user.id },
      data: { name: trimmedName },
      select: { id: true, email: true, name: true, emailVerified: true },
    })

    return NextResponse.json({ user: updated })
  } catch (e) {
    console.error('Update profile error', e)
    return NextResponse.json(
      { error: 'Внутренняя ошибка сервера' },
      { status: 500 },
    )
  }
}
