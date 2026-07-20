'use client'

import { useEffect, useState } from 'react'
import { useReaderStore, type Theme, type FontFamily } from '@/store/reader-store'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Button } from '@/components/ui/button'
import {
  Sun,
  Moon,
  Coffee,
  Contrast,
  AlignLeft,
  AlignJustify,
  Volume2,
  Calendar,
} from 'lucide-react'
import { Separator } from '@/components/ui/separator'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

export function ReaderSettingsPanel() {
  const settings = useReaderStore((s) => s.settings)
  const updateSettings = useReaderStore((s) => s.updateSettings)
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])

  useEffect(() => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return
    const loadVoices = () => {
      const all = window.speechSynthesis.getVoices()
      // Prefer Russian voices first
      const ru = all.filter((v) => v.lang.startsWith('ru'))
      const others = all.filter((v) => !v.lang.startsWith('ru'))
      setVoices([...ru, ...others])
    }
    loadVoices()
    window.speechSynthesis.onvoiceschanged = loadVoices
    return () => {
      window.speechSynthesis.onvoiceschanged = null
    }
  }, [])

  const themes: { key: Theme; label: string; icon: React.ReactNode }[] = [
    { key: 'light', label: 'Светлая', icon: <Sun className="h-4 w-4" /> },
    { key: 'sepia', label: 'Сепия', icon: <Coffee className="h-4 w-4" /> },
    { key: 'dark', label: 'Тёмная', icon: <Moon className="h-4 w-4" /> },
    { key: 'contrast', label: 'Контраст', icon: <Contrast className="h-4 w-4" /> },
  ]

  const fonts: { key: FontFamily; label: string; sample: string }[] = [
    { key: 'serif', label: 'С засечками', sample: 'Aa' },
    { key: 'sans', label: 'Без засечек', sample: 'Aa' },
    { key: 'mono', label: 'Моноширинный', sample: 'Aa' },
  ]

  return (
    <div className="flex flex-col gap-6 px-4 pb-8">
      {/* Theme */}
      <section className="space-y-3">
        <Label className="text-xs uppercase tracking-wide text-muted-foreground">
          Тема оформления
        </Label>
        <div className="grid grid-cols-4 gap-2">
          {themes.map((t) => (
            <Button
              key={t.key}
              variant={settings.theme === t.key ? 'default' : 'outline'}
              size="sm"
              className="flex-col gap-1 h-auto py-2"
              onClick={() => updateSettings({ theme: t.key })}
            >
              {t.icon}
              <span className="text-[10px]">{t.label}</span>
            </Button>
          ))}
        </div>
      </section>

      <Separator />

      {/* Font family */}
      <section className="space-y-3">
        <Label className="text-xs uppercase tracking-wide text-muted-foreground">
          Шрифт
        </Label>
        <div className="grid grid-cols-3 gap-2">
          {fonts.map((f) => (
            <Button
              key={f.key}
              variant={settings.fontFamily === f.key ? 'default' : 'outline'}
              size="sm"
              className="flex-col gap-0.5 h-auto py-2"
              onClick={() => updateSettings({ fontFamily: f.key })}
            >
              <span
                className="text-lg leading-none"
                style={{
                  fontFamily:
                    f.key === 'serif'
                      ? 'Georgia, serif'
                      : f.key === 'sans'
                        ? 'system-ui, sans-serif'
                        : 'ui-monospace, monospace',
                }}
              >
                {f.sample}
              </span>
              <span className="text-[10px]">{f.label}</span>
            </Button>
          ))}
        </div>
      </section>

      <Separator />

      {/* Font size */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">
            Размер шрифта
          </Label>
          <span className="text-sm font-medium tabular-nums">{settings.fontSize}px</span>
        </div>
        <Slider
          value={[settings.fontSize]}
          min={12}
          max={28}
          step={1}
          onValueChange={(v) => updateSettings({ fontSize: v[0] })}
        />
      </section>

      {/* Line height */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">
            Межстрочный интервал
          </Label>
          <span className="text-sm font-medium tabular-nums">
            {settings.lineHeight.toFixed(1)}
          </span>
        </div>
        <Slider
          value={[settings.lineHeight]}
          min={1.2}
          max={2.4}
          step={0.1}
          onValueChange={(v) => updateSettings({ lineHeight: Math.round(v[0] * 10) / 10 })}
        />
      </section>

      {/* Margin */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">
            Поля страницы
          </Label>
          <span className="text-sm font-medium tabular-nums">{settings.margin}</span>
        </div>
        <Slider
          value={[settings.margin]}
          min={1}
          max={6}
          step={1}
          onValueChange={(v) => updateSettings({ margin: v[0] })}
        />
      </section>

      <Separator />

      {/* Text align */}
      <section className="space-y-3">
        <Label className="text-xs uppercase tracking-wide text-muted-foreground">
          Выравнивание
        </Label>
        <ToggleGroup
          type="single"
          value={settings.textAlign}
          onValueChange={(v) => v && updateSettings({ textAlign: v as 'left' | 'justify' })}
          className="grid grid-cols-2 gap-2"
        >
          <ToggleGroupItem value="left" className="gap-2">
            <AlignLeft className="h-4 w-4" /> Влево
          </ToggleGroupItem>
          <ToggleGroupItem value="justify" className="gap-2">
            <AlignJustify className="h-4 w-4" /> По ширине
          </ToggleGroupItem>
        </ToggleGroup>
      </section>

      {/* Hyphenation */}
      <section className="space-y-3">
        <Label className="text-xs uppercase tracking-wide text-muted-foreground">
          Расстановка переносов
        </Label>
        <ToggleGroup
          type="single"
          value={settings.hyphens ? 'on' : 'off'}
          onValueChange={(v) => updateSettings({ hyphens: v === 'on' })}
          className="grid grid-cols-2 gap-2"
        >
          <ToggleGroupItem value="on">Включены</ToggleGroupItem>
          <ToggleGroupItem value="off">Выключены</ToggleGroupItem>
        </ToggleGroup>
      </section>

      <Separator />

      {/* TTS section */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Volume2 className="h-4 w-4 text-muted-foreground" />
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">
            Чтение вслух (TTS)
          </Label>
        </div>

        <div className="space-y-2">
          <Label className="text-xs">Голос</Label>
          <Select
            value={settings.ttsVoice ?? 'default'}
            onValueChange={(v) =>
              updateSettings({ ttsVoice: v === 'default' ? null : v })
            }
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Голос по умолчанию" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="default">Голос по умолчанию</SelectItem>
              {voices.map((v) => (
                <SelectItem key={v.voiceURI} value={v.voiceURI}>
                  {v.name} ({v.lang})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs">Скорость</Label>
            <span className="text-sm font-medium tabular-nums">
              {settings.ttsRate.toFixed(1)}x
            </span>
          </div>
          <Slider
            value={[settings.ttsRate]}
            min={0.5}
            max={2.0}
            step={0.1}
            onValueChange={(v) => updateSettings({ ttsRate: Math.round(v[0] * 10) / 10 })}
          />
        </div>
      </section>

      <Separator />

      {/* Reading goal */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-muted-foreground" />
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">
            Цель чтения на день
          </Label>
        </div>
        <div className="flex items-center justify-between">
          <Label className="text-xs">Минут в день</Label>
          <span className="text-sm font-medium tabular-nums">
            {settings.dailyGoalMinutes} мин
          </span>
        </div>
        <Slider
          value={[settings.dailyGoalMinutes]}
          min={5}
          max={240}
          step={5}
          onValueChange={(v) => updateSettings({ dailyGoalMinutes: v[0] })}
        />
      </section>
    </div>
  )
}
