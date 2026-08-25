/**
 * Проверка детекта заголовков на реальных прайсах.
 *
 *   node scripts/check-parser.mts <файл> [файл ...]
 *   PRICE_SAMPLES="a.xlsx,b.xls" node scripts/check-parser.mts
 *
 * Прайсы поставщиков в репозиторий не кладём — это коммерческие данные.
 * Без аргументов берутся файлы из ./samples, эта папка игнорируется git.
 */
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { readWorkbook, listSheets, readSheet } from '../electron/parser/readWorkbook.ts'

interface Sample { path: string; expectHeader?: number; label?: string }

/**
 * Ожидаемые строки заголовков: samples/expected.json вида
 *   { "оптовый прайс 21.08.26 (2).xlsx": 262 }
 * Файл лежит рядом с прайсами и тоже не попадает в репозиторий. Без него
 * скрипт просто печатает результат, с ним — падает при расхождении.
 */
function expectations(dir: URL): Record<string, number> {
  try {
    return JSON.parse(fs.readFileSync(new URL('expected.json', dir), 'utf8')) as Record<string, number>
  } catch {
    return {}
  }
}

function fromSamplesDir(): Sample[] {
  const dir = new URL('../samples/', import.meta.url)
  const expected = expectations(dir)
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => /\.(xlsx|xls|xlsm|xlsb)$/i.test(f) && !f.startsWith('~$'))
      .sort()
      .map((f) => ({ path: fileURLToPath(new URL(f, dir)), expectHeader: expected[f] }))
  } catch {
    return []
  }
}

const args = process.argv.slice(2)
const samples: Sample[] = args.length
  ? args.map((p) => ({ path: p }))
  : process.env.PRICE_SAMPLES
    ? process.env.PRICE_SAMPLES.split(',').map((p) => ({ path: p.trim() }))
    : fromSamplesDir()

if (samples.length === 0) {
  console.error(
    'Не заданы файлы для проверки.\n' +
      '  node scripts/check-parser.mts <прайс.xlsx> [ещё ...]\n' +
      '  либо сложите прайсы в ./samples',
  )
  process.exit(2)
}

let failed = 0

for (const s of samples) {
  console.log('\n' + '='.repeat(76))
  console.log(s.label ?? s.path.split('/').pop())
  console.log('='.repeat(76))

  const t0 = performance.now()
  const wb = readWorkbook(s.path)
  const tRead = performance.now() - t0

  const sheets = listSheets(wb)
  console.log(`листы: ${sheets.map((x) => `${x.name} (${x.rows}×${x.cols})`).join(', ')}`)

  const t1 = performance.now()
  const sheet = readSheet(wb, sheets[0].name)
  const tParse = performance.now() - t1
  const d = sheet.detection

  console.log(`чтение ${tRead.toFixed(0)}мс · сетка+детект ${tParse.toFixed(0)}мс`)

  const ok = s.expectHeader === undefined || d.headerRow === s.expectHeader
  if (!ok) failed++
  console.log(
    `\nВЫБРАНА строка ${(d.headerRow ?? -1) + 1}` +
      (s.expectHeader === undefined ? '' : ok ? '  ✓ верно' : `  ✗ ОЖИДАЛАСЬ ${s.expectHeader + 1}`),
  )

  console.log('\nкандидаты:')
  console.log('   строка  товаров   вес  поля')
  for (const c of d.candidates) {
    const fields = Object.entries(c.map.fields).map(([k, v]) => `${k}:${v}`).join(' ')
    console.log(
      `${c.row === d.headerRow ? ' ►' : '  '}${String(c.row + 1).padStart(6)} ${String(c.dataRows).padStart(8)} ${String(c.score).padStart(5)}  ${fields}`,
    )
  }

  if (d.map && d.headerRow !== null) {
    const head = sheet.grid[d.headerRow]
    console.log('\nколонки выбранной таблицы:')
    for (const [field, col] of Object.entries(d.map.fields)) {
      console.log(`  ${field.padEnd(13)} col ${String(col).padStart(2)}  «${String(head[col as number] ?? '')}»`)
    }
    console.log(
      `  ${'extra'.padEnd(13)} ${d.map.extra.map((c) => `«${String(head[c] ?? '')}»`).join(' ') || '—'}`,
    )
  }
}

if (failed > 0) {
  console.error(`\n${failed} из ${samples.length} — детект не совпал с ожиданием`)
  process.exit(1)
}
console.log(`\n✓ все ${samples.length} образца определены верно`)
