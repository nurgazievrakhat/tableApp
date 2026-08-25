import { useEffect } from 'react'

/**
 * Общее поведение модальных окон: закрытие по Esc и блокировка прокрутки
 * страницы под окном. Без блокировки фон уезжает под курсором, и после
 * закрытия пользователь оказывается не там, где был.
 *
 * @param enabled выключается, когда поверх открыто ещё одно окно — тогда Esc
 *                должен закрывать только верхнее.
 */
export function useModal(onClose: () => void, enabled = true): void {
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  useEffect(() => {
    if (!enabled) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, enabled])
}
