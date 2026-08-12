'use client'

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const shortcuts: { key: string; description: string }[] = [
  { key: '←', description: 'Предыдущая страница' },
  { key: '→', description: 'Следующая страница' },
  { key: 'Ctrl/⌘ + F', description: 'Поиск по книге' },
  { key: 'Ctrl/⌘ + B', description: 'Добавить закладку' },
  { key: 'F', description: 'Полноэкранный режим' },
  { key: '+', description: 'Увеличить масштаб (PDF)' },
  { key: '−', description: 'Уменьшить масштаб (PDF)' },
  { key: '?', description: 'Показать эту справку' },
  { key: 'Esc', description: 'Закрыть окно' },
]

export function ShortcutsHelp({ open, onOpenChange }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Горячие клавиши</DialogTitle>
        </DialogHeader>
        <ul className="space-y-2">
          {shortcuts.map((s) => (
            <li key={s.key} className="flex items-center justify-between gap-4">
              <span className="text-sm text-muted-foreground">{s.description}</span>
              <kbd className="rounded border bg-muted px-2 py-0.5 text-xs font-mono">
                {s.key}
              </kbd>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  )
}
