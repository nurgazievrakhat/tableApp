import { getDatabase } from '../connection.ts'

export interface LinkStats {
  /** Сколько позиций связались по совпавшему артикулу. */
  byArticle: number
  /** Сколько позиций получило товар (все связанные). */
  byName: number
  products: number
  /** Товары, которые есть больше чем у одного поставщика — ради них всё и делается. */
  multiSupplier: number
  elapsedMs: number
}

/**
 * Склейка позиций в канонические товары (ARCHITECTURE.md §7).
 *
 * Автоматически связываем только по точным ключам: совпал нормализованный
 * артикул или совпало нормализованное название. Нечёткое сходство сюда не
 * допускается — на реальных прайсах «АЗИТРОМИЦИН 500мг №3 табл САНДОЗ» и
 * «... АДЖИО» дают схожесть 0.92, будучи разными товарами, а верное совпадение
 * «МАСЛО КРИЛЯ» — только 0.83. Порог, разделяющий их, не существует, и цена
 * ошибки — неверное сравнение цен.
 *
 * Связи перестраиваются целиком при каждом импорте: новая позиция может
 * связать между собой две группы, существовавшие порознь. Ручные склейки при
 * перестройке не трогаются.
 */
export function linkProducts(): LinkStats {
  const db = getDatabase()
  const started = Date.now()

  interface ItemRow {
    id: number
    name: string
    article_norm: string | null
    name_norm: string
  }

  const run = db.transaction((): { byArticle: number; byName: number } => {
    // Ручные склейки неприкосновенны — их позиции в перестройке не участвуют.
    const manual = new Set(
      (
        db
          .prepare(
            `SELECT i.id FROM items i JOIN products p ON p.id = i.product_id
             WHERE p.created_by = 'manual'`,
          )
          .all() as { id: number }[]
      ).map((r) => r.id),
    )

    db.prepare(
      `UPDATE items SET product_id = NULL WHERE product_id IN
         (SELECT id FROM products WHERE created_by = 'auto')`,
    ).run()
    db.prepare(`DELETE FROM products WHERE created_by = 'auto'`).run()

    const items = (
      db.prepare('SELECT id, name, article_norm, name_norm FROM items').all() as ItemRow[]
    ).filter((it) => !manual.has(it.id))

    // Объединение множеств: позиции связаны, если совпал артикул ИЛИ название.
    // Раздельные проходы здесь не годятся — у поставщика с артикулами позиция
    // уходила в собственный товар и не склеивалась по названию с теми, у кого
    // артикулов нет. «АЭРТАЛ 100мг №20 табл» так и оставался тремя товарами.
    const parent = new Int32Array(items.length).map((_, i) => i)
    const find = (x: number): number => {
      let root = x
      while (parent[root] !== root) root = parent[root]
      while (parent[x] !== root) { const next = parent[x]; parent[x] = root; x = next }
      return root
    }
    const union = (a: number, b: number): void => {
      const ra = find(a), rb = find(b)
      if (ra !== rb) parent[ra] = rb
    }

    let byArticle = 0
    const groupBy = (key: (it: ItemRow) => string | null, count: boolean): void => {
      const first = new Map<string, number>()
      items.forEach((it, i) => {
        const k = key(it)
        if (!k) return
        const seen = first.get(k)
        if (seen === undefined) first.set(k, i)
        else { union(seen, i); if (count) byArticle++ }
      })
    }

    groupBy((it) => (it.article_norm && it.article_norm !== '' ? 'A:' + it.article_norm : null), true)
    groupBy((it) => (it.name_norm !== '' ? 'N:' + it.name_norm : null), false)

    // Компоненты связности — это и есть канонические товары.
    const components = new Map<number, number[]>()
    items.forEach((_, i) => {
      const root = find(i)
      const list = components.get(root)
      if (list) list.push(i)
      else components.set(root, [i])
    })

    const insertProduct = db.prepare(
      `INSERT INTO products(title, match_key, created_by) VALUES (?, ?, 'auto')`,
    )
    const assign = db.prepare('UPDATE items SET product_id = ? WHERE id = ?')

    let byName = 0
    for (const [, idx] of components) {
      const members = idx.map((i) => items[i])
      // Ключ детерминированный: артикул надёжнее, при его отсутствии название.
      const articles = members.map((m) => m.article_norm).filter((a): a is string => !!a).sort()
      const key = articles.length
        ? 'A:' + articles[0]
        : 'N:' + members.map((m) => m.name_norm).sort()[0]
      const title = members.map((m) => m.name).sort()[0]

      const productId = Number(insertProduct.run(title, key).lastInsertRowid)
      for (const m of members) { assign.run(productId, m.id); byName++ }
    }

    return { byArticle, byName }
  })

  const { byArticle, byName } = run()

  const products = (db.prepare('SELECT count(*) AS n FROM products').get() as { n: number }).n
  const multiSupplier = (
    db
      .prepare(
        `SELECT count(*) AS n FROM (
           SELECT product_id FROM items
           WHERE product_id IS NOT NULL AND is_active = 1
           GROUP BY product_id HAVING count(DISTINCT supplier_id) > 1)`,
      )
      .get() as { n: number }
  ).n

  return { byArticle, byName, products, multiSupplier, elapsedMs: Date.now() - started }
}

/** Товары без связей — например, после удаления источника. */
export function pruneProducts(): number {
  return getDatabase()
    .prepare(
      `DELETE FROM products
       WHERE created_by = 'auto'
         AND NOT EXISTS (SELECT 1 FROM items i WHERE i.product_id = products.id)`,
    )
    .run().changes
}

/**
 * Ручная склейка: позиции переносятся к товару-получателю, и он помечается
 * ручным, чтобы автоматика его больше не трогала.
 */
export function mergeProducts(targetId: number, sourceIds: number[]): void {
  if (sourceIds.length === 0) return
  const db = getDatabase()

  db.transaction(() => {
    const placeholders = sourceIds.map(() => '?').join(',')
    db.prepare(
      `UPDATE items SET product_id = ? WHERE product_id IN (${placeholders})`,
    ).run(targetId, ...sourceIds)

    db.prepare(`UPDATE products SET created_by = 'manual' WHERE id = ?`).run(targetId)
    db.prepare(`DELETE FROM products WHERE id IN (${placeholders})`).run(...sourceIds)
  })()
}

/** Разделить ошибочно склеенное: позиции возвращаются к своим ключам. */
export function unmergeProduct(productId: number): void {
  const db = getDatabase()
  db.transaction(() => {
    db.prepare('UPDATE items SET product_id = NULL WHERE product_id = ?').run(productId)
    db.prepare('DELETE FROM products WHERE id = ?').run(productId)
  })()
  linkProducts()
}

export interface MatchSuggestion {
  productId: number
  title: string
  suppliers: string[]
  minPrice: number | null
  /** Что именно совпало — чтобы человек мог решить, не вчитываясь. */
  matched: string[]
}

interface Features {
  brand: string
  doses: string
  counts: string
}

const DOSE_RE = /(\d+(?:\.\d+)?)\s*(мг|мкг|г|мл|л|ме|%)(?![а-яa-z])/g
const COUNT_RE = /№(\d+)/g

/** Разбор названия на признаки: бренд, дозировки, количество в упаковке. */
function features(nameNorm: string): Features {
  const doses = [...nameNorm.matchAll(DOSE_RE)].map((m) => `${m[1]}${m[2]}`).sort()
  const counts = [...nameNorm.matchAll(COUNT_RE)].map((m) => m[1]).sort()
  return {
    brand: nameNorm.split(' ')[0] ?? '',
    doses: doses.join(','),
    counts: counts.join(','),
  }
}

/**
 * Возможные склейки для одного товара — считаются по требованию, а не заранее
 * (ARCHITECTURE.md §7).
 *
 * Совпадать должны бренд, все дозировки и всё количество в упаковке. Это
 * заметно строже, чем сходство строк, но всё равно НЕ повод склеивать
 * автоматически: «АДЖИСЕПТ №24 ЛИМОН» и «АДЖИСЕПТ №24 МЕД» по этим признакам
 * неотличимы, а это разные товары. Поэтому — только предложение человеку.
 */
export function suggestMatches(productId: number, limit = 8): MatchSuggestion[] {
  const db = getDatabase()

  const own = db
    .prepare(
      `SELECT i.name_norm, i.supplier_id FROM items i
       WHERE i.product_id = ? AND i.is_active = 1`,
    )
    .all(productId) as { name_norm: string; supplier_id: number }[]
  if (own.length === 0) return []

  const f = features(own[0].name_norm)
  if (f.brand.length < 3) return []
  const mySuppliers = new Set(own.map((o) => o.supplier_id))

  // Сужаем перебор брендом: сравнивать признаки со всей базой незачем.
  const rows = db
    .prepare(
      `SELECT i.product_id, i.name_norm, i.supplier_id, s.name AS supplier_name,
              i.price, p.title
       FROM items i
       JOIN suppliers s ON s.id = i.supplier_id
       JOIN products p ON p.id = i.product_id
       WHERE i.is_active = 1
         AND i.product_id != ?
         AND (i.name_norm = ? OR i.name_norm LIKE ?)`,
    )
    .all(productId, own[0].name_norm, f.brand + ' %') as {
    product_id: number
    name_norm: string
    supplier_id: number
    supplier_name: string
    price: number | null
    title: string
  }[]

  const byProduct = new Map<number, typeof rows>()
  for (const r of rows) {
    const list = byProduct.get(r.product_id)
    if (list) list.push(r)
    else byProduct.set(r.product_id, [r])
  }

  const out: MatchSuggestion[] = []
  for (const [pid, group] of byProduct) {
    const g = features(group[0].name_norm)
    if (g.brand !== f.brand || g.doses !== f.doses || g.counts !== f.counts) continue

    // Предлагать имеет смысл только то, что добавляет нового поставщика.
    const suppliers = [...new Set(group.map((r) => r.supplier_name))]
    if (group.every((r) => mySuppliers.has(r.supplier_id))) continue

    const prices = group.map((r) => r.price).filter((p): p is number => p !== null)
    const matched = ['бренд']
    if (f.doses) matched.push(`дозировка ${f.doses}`)
    if (f.counts) matched.push(`№${f.counts}`)

    out.push({
      productId: pid,
      title: group[0].title,
      suppliers,
      minPrice: prices.length ? Math.min(...prices) : null,
      matched,
    })
  }

  return out.slice(0, limit)
}
