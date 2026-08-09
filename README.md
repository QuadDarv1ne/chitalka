# Читалка — удобная читалка книг

Современное веб-приложение для чтения книг с поддержкой EPUB, FB2, PDF, TXT, Markdown и HTML.
Локальное хранение в IndexedDB, аккаунты с синхронизацией прогресса между устройствами.

## Возможности

### Чтение книг
- 📚 **Форматы**: EPUB, FB2, PDF, TXT, Markdown, HTML
- 🎨 **4 темы**: светлая, тёмная, сепия, контраст
- 🔤 **3 шрифта**: с засечками, без засечек, моноширинный
- 📏 **Настройки**: размер шрифта (12-28px), межстрочный интервал, поля, выравнивание, переносы
- 📖 **Пагинация**: автоматическая с разрывом на главах
- 🔄 **Позиция**: сохранение прогресса между сессиями
- 🔊 **TTS**: чтение вслух через Web Speech API

### Библиотека
- 💾 **Локальное хранение** в IndexedDB (файлы не покидают браузер)
- 🖼️ **Обложки** автоматически извлекаются из EPUB/FB2/PDF
- 🏷️ **Цветные бейджи** форматов
- 🔍 **Поиск** по названию и автору
- 🔀 **Сортировка**: недавние, по дате, по названию
- 🎯 **Фильтр** по формату
- ⚡ **Drag & Drop** загрузка файлов
- 📚 **"Продолжить чтение"** — карусель недавних книг
- 💾 **Backup** в JSON

### Аккаунты и синхронизация
- 🔐 **Регистрация** с email и паролем
- ✉️ **Верификация email** — токен действителен 7 дней
- 🔑 **Восстановление пароля** по email
- 🎟️ **Управление сессиями** — список всех устройств, завершение сессий
- 🔒 **Remember me** — 30 дней или 1 год
- ☁️ **Синхронизация прогресса** чтения между устройствами
- ⚙️ **Синхронизация настроек** читалки
- 📤 **Экспорт данных** аккаунта
- 🗑️ **Удаление аккаунта** с подтверждением

### Чтение и заметки
- 📑 **Оглавление**: для EPUB из navigation.xml, для FB2/TXT — автоопределение «Глава N.»
- 🔖 **Закладки** с быстрым переходом
- 🖍️ **Выделения** — 5 цветов с заметками
- 🔍 **Полнотекстовый поиск** по книге (Ctrl+F)
- 📊 **Статистика** чтения: время, страницы, streak
- 🎯 **Цели** дня с прогресс-баром

### Безопасность
- 🔐 **bcrypt** хеширование паролей (12 rounds)
- 🎫 **JWT** сессии в httpOnly cookies
- 🛡️ **Rate limiting**: login 10/15мин, register 5/час, forgot 5/час
- 🚫 **Email enumeration** защита
- 🔁 **Одноразовые токены** для reset/verify
- 🍪 **SameSite=lax**, secure в production

## Технологии

- **Frontend**: Next.js 16 (App Router), React 19, TypeScript
- **UI**: Tailwind CSS 4, shadcn/ui, Framer Motion
- **Backend**: Next.js API Routes, Prisma ORM, SQLite
- **Auth**: bcryptjs, jose (JWT)
- **Storage**: IndexedDB (idb), localStorage (Zustand persist)
- **Чтение**: epubjs, pdfjs-dist, собственный парсер FB2
- **Графики**: Recharts
- **State**: Zustand

## Установка

```bash
# Установить зависимости
bun install

# Применить схему БД
bun run db:push

# Запуск в dev-режиме
bun run dev

# Сборка для production
bun run build
bun run start
```

## Развертывание на Amvera Cloud

Проект готов к деплою на [Amvera](https://amvera.ru/) (`amvera.yaml` + `Dockerfile`,
сборка через Docker, Next.js standalone). База данных SQLite хранится в постоянном
хранилище `/data`, поэтому аккаунты и прогресс переживают пересборки.

1. Создайте проект в Amvera и подключите этот репозиторий (GitHub) или запушьте
   его в `https://git.amvera.ru/<user>/<project>.git`.
2. В разделе «Настройки» добавьте бесплатное доменное имя:
   `https://<project>.<user>.amvera.io`.
3. В разделе «Переменные и секреты» задайте:
   - `JWT_SECRET` — `openssl rand -hex 32`
   - `NEXT_PUBLIC_APP_URL` — `https://<project>.<user>.amvera.io`
4. Запустите сборку. Приложение слушает порт 3000, на старте автоматически
   применяет схему Prisma (`prisma db push`) к `file:/data/chitalka.db`.
5. Письма в production доставляются через Resend (HTTP API, без доп. зависимостей).
   Задайте `RESEND_API_KEY` и, при необходимости, `RESEND_FROM`. Без них письма
   не отправляются, но регистрация/сброс пароля продолжают работать (ошибка
   доставки логируется).

## Переменные окружения

Создайте `.env` файл:

```env
DATABASE_URL="file:./db/custom.db"
JWT_SECRET="your-32-char-secret-here-change-in-production"
NEXT_PUBLIC_APP_URL="http://localhost:3000"
```

## Email-сервис для production

В dev-режиме используется mock email-сервис (`src/lib/email.ts`), который логирует
письма в консоль и временный файл. В production, если задан `RESEND_API_KEY`,
письма отправляются через [Resend](https://resend.com/) HTTP API:

```env
RESEND_API_KEY="re_..."
RESEND_FROM="Читалка <no-reply@yourdomain.com>"
```

Адрес отправителя должен быть подтверждён в аккаунте Resend. Если ключ не задан —
доставка пропускается, а ошибка логируется (регистрация и сброс пароля при этом
продолжают работать). Для другого провайдера замените `sendViaResend()` в
`src/lib/email.ts`.

## Структура проекта

```
src/
├── app/
│   ├── api/
│   │   ├── auth/           # Auth endpoints
│   │   │   ├── register/
│   │   │   ├── login/
│   │   │   ├── logout/
│   │   │   ├── me/
│   │   │   ├── forgot-password/
│   │   │   ├── reset-password/
│   │   │   ├── verify-email/
│   │   │   ├── resend-verification/
│   │   │   ├── update-profile/
│   │   │   ├── change-password/
│   │   │   ├── delete-account/
│   │   │   ├── sessions/
│   │   │   └── emails/      # Dev-only inbox
│   │   ├── books/sync/      # Book metadata sync
│   │   └── user/
│   │       ├── settings/    # User settings sync
│   │       └── export/      # Account data export
│   ├── layout.tsx
│   └── page.tsx
├── components/
│   ├── account/             # Account page
│   ├── auth/                # Auth dialogs, UserMenu
│   ├── library/             # Library page
│   ├── reader/              # Reader + panels
│   ├── stats/               # Stats page
│   └── ui/                  # shadcn/ui components
├── hooks/
│   ├── use-auth.tsx         # Auth context
│   ├── use-book-sync.ts     # Book progress sync
│   ├── use-reading-tracker.ts
│   └── use-tts.ts           # Text-to-speech
├── lib/
│   ├── auth.ts              # Password, JWT, sessions
│   ├── book-parser.ts       # EPUB/FB2/PDF parsers
│   ├── email.ts             # Mock email service
│   ├── export-utils.ts      # Markdown/JSON export
│   ├── highlights-utils.tsx # Highlight rendering
│   ├── library.ts           # IndexedDB storage
│   ├── rate-limit.ts        # Rate limiting
│   ├── session.ts           # Session helpers
│   └── db.ts                # Prisma client
└── store/
    └── reader-store.ts      # Zustand store
```

## API Reference

### Auth
- `POST /api/auth/register` — регистрация
- `POST /api/auth/login` — вход
- `POST /api/auth/logout` — выход
- `GET /api/auth/me` — текущий пользователь
- `POST /api/auth/forgot-password` — запрос сброса пароля
- `POST /api/auth/reset-password` — сброс пароля по токену
- `POST /api/auth/verify-email` — подтверждение email
- `POST /api/auth/resend-verification` — повторная отправка письма
- `PATCH /api/auth/update-profile` — обновление профиля
- `POST /api/auth/change-password` — смена пароля
- `POST /api/auth/delete-account` — удаление аккаунта
- `GET /api/auth/sessions` — список сессий
- `DELETE /api/auth/sessions?id=X` — завершить сессию

### Books
- `POST /api/books/sync` — синхронизация метаданных
- `GET /api/books/sync` — получение синхронизированных книг

### User
- `GET /api/user/settings` — получить настройки
- `PUT /api/user/settings` — обновить настройки
- `GET /api/user/export` — экспорт данных аккаунта

## Горячие клавиши

- `←` / `→` — перелистывание страниц
- `Ctrl/⌘ + F` — поиск по книге
- `Ctrl/⌘ + B` — закладки
- `+` / `-` — масштаб PDF
- `?` — справка
- `Esc` — закрыть окно

## Лицензия

MIT
