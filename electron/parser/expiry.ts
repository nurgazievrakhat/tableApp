/**
 * Срок годности. Поставщики пишут его по-разному:
 *   Неман-Фарм  «12-27», « 08-28»  — месяц-год, ноль означает «бессрочно»
 *   Фармамир    «30.09.2028»       — полная дата
 *
 * Приводим к unixepoch. Для формата месяц-год берём конец месяца: товар
 * годен весь указанный месяц.
 */
export function parseExpiry(raw: unknown): number | null {
  if (raw instanceof Date) return Math.floor(raw.getTime() / 1000)

  const s = String(raw ?? '').trim()
  if (s === '' || s === '0') return null

  const dmy = /^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/.exec(s)
  if (dmy) {
    const year = dmy[3].length === 2 ? 2000 + Number(dmy[3]) : Number(dmy[3])
    return Math.floor(Date.UTC(year, Number(dmy[2]) - 1, Number(dmy[1])) / 1000)
  }

  const my = /^(\d{1,2})[-./](\d{2,4})$/.exec(s)
  if (my) {
    const month = Number(my[1])
    if (month < 1 || month > 12) return null
    const year = my[2].length === 2 ? 2000 + Number(my[2]) : Number(my[2])
    // Нулевой день следующего месяца — последний день текущего.
    return Math.floor(Date.UTC(year, month, 0) / 1000)
  }

  return null
}
