-- Начальная схема. См. ARCHITECTURE.md §4.

CREATE TABLE suppliers (
  id         INTEGER PRIMARY KEY,
  name       TEXT    NOT NULL UNIQUE,
  note       TEXT,
  -- Включён ли НДС в цену прайса. NULL = не выяснено (см. ARCHITECTURE.md §15).
  price_includes_vat INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Как читать конкретный прайс. Ключевая таблица для «импорт в один клик»:
-- по signature опознаётся поставщик у файла, появившегося в папке (§9).
CREATE TABLE mappings (
  id               INTEGER PRIMARY KEY,
  supplier_id      INTEGER REFERENCES suppliers(id) ON DELETE CASCADE,
  signature        TEXT,              -- sha1 нормализованной строки заголовков
  filename_mask    TEXT,              -- 'Прайс Фармамир от *.xls', разрешает коллизии signature
  header_row       INTEGER NOT NULL,
  data_start_row   INTEGER,
  columns_json     TEXT    NOT NULL,  -- {"name":2,"price":6,"unit":5,...}, 1-based
  currency         TEXT    NOT NULL DEFAULT 'KGS',
  price_multiplier REAL    NOT NULL DEFAULT 1.0,
  created_at       INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_mappings_signature ON mappings(signature);

CREATE TABLE files (
  id          INTEGER PRIMARY KEY,
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  path        TEXT    NOT NULL,
  sheet       TEXT    NOT NULL,
  file_hash   TEXT,                   -- sha1 содержимого: отсекает повторную загрузку «(2).xlsx»
  mtime       INTEGER,
  mapping_id  INTEGER REFERENCES mappings(id),
  UNIQUE(path, sheet)
);
CREATE INDEX idx_files_hash ON files(file_hash);

CREATE TABLE imports (
  id           INTEGER PRIMARY KEY,
  file_id      INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  imported_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  price_date   INTEGER,               -- дата прайса из файла, не mtime (§9)
  rows_total   INTEGER,
  rows_ok      INTEGER,
  rows_skipped INTEGER
);
CREATE INDEX idx_imports_file ON imports(file_id);

-- Канонический товар: склеивает позиции разных поставщиков (§7).
CREATE TABLE products (
  id         INTEGER PRIMARY KEY,
  title      TEXT    NOT NULL,
  match_key  TEXT    UNIQUE,          -- article_norm или name_norm, по которому склеили
  created_by TEXT    NOT NULL DEFAULT 'auto' CHECK (created_by IN ('auto','manual'))
);

-- Актуальная позиция прайса: одна строка на товар поставщика.
CREATE TABLE items (
  id             INTEGER PRIMARY KEY,
  supplier_id    INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  file_id        INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  item_key       TEXT    NOT NULL,    -- стабильный ключ внутри поставщика (§7)
  name           TEXT    NOT NULL,
  name_norm      TEXT    NOT NULL,
  article        TEXT,
  article_norm   TEXT,
  price          REAL,                -- ровно как в прайсе
  currency       TEXT,
  promo_raw      TEXT,                -- исходный текст колонки «Акция»
  promo_pct      REAL,                -- безусловная скидка, %
  promo_from     INTEGER,
  promo_to       INTEGER,
  bulk_pct       REAL,                -- доп. скидка от количества, %
  bulk_min_qty   INTEGER,
  unit           TEXT,
  unit_norm      TEXT,                -- упак/уп/упаковка -> уп
  stock          TEXT,
  manufacturer   TEXT,
  expiry         INTEGER,             -- срок годности, приведён к концу месяца
  category       TEXT,
  row_no         INTEGER,             -- «показать, откуда взято»
  extra_json     TEXT,                -- прочие колонки прайса + duplicate_rows, для показа
  -- Те же значения плоским текстом — только для FTS. Имя обязано совпадать
  -- с колонкой items_fts: при content='items' FTS5 ищет её в таблице по имени.
  extra_text     TEXT,
  product_id     INTEGER REFERENCES products(id) ON DELETE SET NULL,
  last_import_id INTEGER REFERENCES imports(id),
  is_active      INTEGER NOT NULL DEFAULT 1,
  UNIQUE(supplier_id, item_key)
);
CREATE INDEX idx_items_supplier ON items(supplier_id);
CREATE INDEX idx_items_product  ON items(product_id);
CREATE INDEX idx_items_article  ON items(article_norm) WHERE article_norm IS NOT NULL;
CREATE INDEX idx_items_name     ON items(name_norm);

-- История цен: запись только при фактическом изменении (§8).
CREATE TABLE price_history (
  item_id    INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  price      REAL,
  currency   TEXT,
  changed_at INTEGER NOT NULL,
  import_id  INTEGER REFERENCES imports(id),
  PRIMARY KEY (item_id, changed_at)
) WITHOUT ROWID;

-- Очередь подтверждения склеек. Ленивая: строится для товаров,
-- которые пользователь реально открыл в поиске (§7).
CREATE TABLE match_candidates (
  id         INTEGER PRIMARY KEY,
  item_a_id  INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  item_b_id  INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  reason     TEXT    NOT NULL,   -- 'brand_dose_count' | 'fuzzy'
  score      REAL,
  status     TEXT    NOT NULL DEFAULT 'pending'
             CHECK (status IN ('pending','confirmed','rejected')),
  decided_at INTEGER,
  UNIQUE(item_a_id, item_b_id)
);
CREATE INDEX idx_candidates_status ON match_candidates(status);

CREATE TABLE watched_folders (
  id      INTEGER PRIMARY KEY,
  path    TEXT    NOT NULL UNIQUE,
  enabled INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- Полнотекстовый поиск (§6). external content: индекс ссылается на items.
CREATE VIRTUAL TABLE items_fts USING fts5(
  name_norm, article_norm, extra_text,
  content='items', content_rowid='id',
  tokenize='unicode61 remove_diacritics 2'
);

-- Синхронизация индекса. На массовой вставке импорт оборачивает всё в одну
-- транзакцию; если окажется медленно — триггеры снимаются на время загрузки
-- и индекс достраивается через INSERT INTO items_fts(items_fts) VALUES('rebuild').
CREATE TRIGGER items_fts_ai AFTER INSERT ON items BEGIN
  INSERT INTO items_fts(rowid, name_norm, article_norm, extra_text)
  VALUES (new.id, new.name_norm, new.article_norm, new.extra_text);
END;
CREATE TRIGGER items_fts_ad AFTER DELETE ON items BEGIN
  INSERT INTO items_fts(items_fts, rowid, name_norm, article_norm, extra_text)
  VALUES ('delete', old.id, old.name_norm, old.article_norm, old.extra_text);
END;
CREATE TRIGGER items_fts_au AFTER UPDATE ON items BEGIN
  INSERT INTO items_fts(items_fts, rowid, name_norm, article_norm, extra_text)
  VALUES ('delete', old.id, old.name_norm, old.article_norm, old.extra_text);
  INSERT INTO items_fts(rowid, name_norm, article_norm, extra_text)
  VALUES (new.id, new.name_norm, new.article_norm, new.extra_text);
END;
