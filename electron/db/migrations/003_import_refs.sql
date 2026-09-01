-- Ссылки на imports без правила при удалении ломали удаление источника.
--
-- В price_history записано, какой импорт изменил цену. Позже позиция переезжает
-- к более свежему прайсу, а запись истории продолжает ссылаться на старый
-- импорт — и это правильно, так и задумано. Но связь была объявлена без
-- ON DELETE, то есть NO ACTION: удаление файла каскадом сносило его импорты, а
-- записи истории оставались висеть на них, и SQLite отвечал
-- «FOREIGN KEY constraint failed».
--
-- То же самое у items.last_import_id: items и imports оба каскадно удаляются
-- от files, и если imports удалятся первыми, ещё живые items нарушат связь.
--
-- Правильное поведение — SET NULL: сам факт изменения цены остаётся, теряется
-- только указание, каким импортом оно вызвано.
--
-- Изменить ограничение в SQLite нельзя, таблицы пересобираются. Порядок
-- «создать новую → удалить старую → переименовать» выбран намеренно: если
-- переименовывать старую таблицу, SQLite перепишет ссылки на неё в других
-- таблицах, и price_history начнёт указывать на items_old.

CREATE TABLE price_history_new (
  item_id    INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  price      REAL,
  currency   TEXT,
  changed_at INTEGER NOT NULL,
  import_id  INTEGER REFERENCES imports(id) ON DELETE SET NULL,
  PRIMARY KEY (item_id, changed_at)
) WITHOUT ROWID;

INSERT INTO price_history_new SELECT item_id, price, currency, changed_at, import_id
FROM price_history;

DROP TABLE price_history;
ALTER TABLE price_history_new RENAME TO price_history;

-- items пересобираем вместе с индексами и триггерами FTS: они удаляются
-- вместе с таблицей.
DROP TRIGGER items_fts_ai;
DROP TRIGGER items_fts_ad;
DROP TRIGGER items_fts_au;

CREATE TABLE items_new (
  id             INTEGER PRIMARY KEY,
  supplier_id    INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  file_id        INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  item_key       TEXT    NOT NULL,
  name           TEXT    NOT NULL,
  name_norm      TEXT    NOT NULL,
  article        TEXT,
  article_norm   TEXT,
  price          REAL,
  currency       TEXT,
  promo_raw      TEXT,
  promo_pct      REAL,
  promo_from     INTEGER,
  promo_to       INTEGER,
  bulk_pct       REAL,
  bulk_min_qty   INTEGER,
  unit           TEXT,
  unit_norm      TEXT,
  stock          TEXT,
  manufacturer   TEXT,
  expiry         INTEGER,
  category       TEXT,
  row_no         INTEGER,
  extra_json     TEXT,
  extra_text     TEXT,
  product_id     INTEGER REFERENCES products(id) ON DELETE SET NULL,
  last_import_id INTEGER REFERENCES imports(id) ON DELETE SET NULL,
  is_active      INTEGER NOT NULL DEFAULT 1,
  UNIQUE(supplier_id, item_key)
);

INSERT INTO items_new SELECT
  id, supplier_id, file_id, item_key, name, name_norm, article, article_norm,
  price, currency, promo_raw, promo_pct, promo_from, promo_to, bulk_pct,
  bulk_min_qty, unit, unit_norm, stock, manufacturer, expiry, category,
  row_no, extra_json, extra_text, product_id, last_import_id, is_active
FROM items;

DROP TABLE items;
ALTER TABLE items_new RENAME TO items;

CREATE INDEX idx_items_supplier ON items(supplier_id);
CREATE INDEX idx_items_product  ON items(product_id);
CREATE INDEX idx_items_article  ON items(article_norm) WHERE article_norm IS NOT NULL;
CREATE INDEX idx_items_name     ON items(name_norm);

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

-- Индекс поиска ссылается на items по rowid, а таблица пересоздана — собираем
-- заново. Идентификаторы сохранены, так что содержимое сойдётся.
INSERT INTO items_fts(items_fts) VALUES('rebuild');
