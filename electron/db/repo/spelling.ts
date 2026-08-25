import { getDatabase } from '../connection.ts'

/**
 * Исправление опечаток по словарю поискового индекса.
 *
 * Словарь берётся из самих прайсов, а не из словаря языка: «ВВГнг», «АЭРТАЛ»,
 * «СОЛГАР» ни в каком общем словаре не встретятся, зато в товарных названиях
 * это самые частые слова.
 */

let cache: { term: string; cnt: number }[] | null = null

/** Сбрасывается после импорта: словарь меняется вместе с содержимым базы. */
export function invalidateVocabulary(): void {
  cache = null
}

function vocabulary(): { term: string; cnt: number }[] {
  if (cache) return cache
  cache = getDatabase()
    .prepare('SELECT term, cnt FROM items_vocab WHERE length(term) > 1')
    .all() as { term: string; cnt: number }[]
  return cache
}

/** Расстояние Левенштейна с досрочным выходом, когда превышен предел. */
export function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1
  if (a === b) return 0

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  let curr = new Array<number>(b.length + 1)

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i
    let rowMin = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost)
      if (curr[j] < rowMin) rowMin = curr[j]
    }
    if (rowMin > max) return max + 1
    ;[prev, curr] = [curr, prev]
  }
  return prev[b.length]
}

/** Короткие слова правим осторожнее: в них одна замена меняет смысл. */
function budget(token: string): number {
  if (token.length <= 3) return 0
  if (token.length <= 5) return 1
  return 2
}

/**
 * Ближайшее слово из словаря. При равном расстоянии побеждает более частое —
 * пользователь скорее искал ходовой товар, чем редкий.
 */
export function correctToken(token: string): string | null {
  const max = budget(token)
  if (max === 0) return null

  let best: { term: string; dist: number; cnt: number } | null = null
  for (const { term, cnt } of vocabulary()) {
    const dist = editDistance(token, term, max)
    if (dist > max) continue
    if (!best || dist < best.dist || (dist === best.dist && cnt > best.cnt)) {
      best = { term, dist, cnt }
    }
  }
  return best && best.term !== token ? best.term : null
}

/** Есть ли такое слово в прайсах — префиксно, как ищет FTS. */
export function tokenExists(token: string): boolean {
  return vocabulary().some((v) => v.term.startsWith(token))
}
