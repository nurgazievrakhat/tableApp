import type { Field } from '@shared/types'

export const FIELD_LABEL: Record<Field, string> = {
  rowNum: '№ п/п',
  name: 'Наименование',
  price: 'Цена',
  priceAlt: 'Вторая цена',
  article: 'Артикул',
  unit: 'Ед. изм.',
  stock: 'Остаток',
  manufacturer: 'Производитель',
  expiry: 'Срок годности',
  promo: 'Акция',
  vat: 'НДС',
  packQty: 'Кол-во в упак.',
}

/** Порядок в выпадающем списке: сначала то, что нужно почти всегда. */
export const FIELD_ORDER: Field[] = [
  'name', 'price', 'priceAlt', 'article', 'unit', 'stock',
  'manufacturer', 'expiry', 'promo', 'vat', 'packQty', 'rowNum',
]

/** Без наименования и цены импорт бессмысленен. */
export const REQUIRED_FIELDS: Field[] = ['name', 'price']
