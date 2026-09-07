-- UNIQUE на products.match_key ломал импорт.
--
-- Ключ записывается, чтобы было видно, по чему склеили позиции; его никто не
-- читает — ни поиск, ни связывание, ни интерфейс. А ограничение UNIQUE
-- утверждало то, чего в данных нет: «один товар на ключ».
--
-- Ручная склейка это утверждение нарушает по своей природе. Товар, склеенный
-- человеком, помечается created_by = 'manual' и в перестройке связей больше не
-- участвует — но свой match_key держит вечно. Если его позиции потом исчезли
-- (удалили поставщика, перезалили прайс под другим именем), товар остаётся
-- пустым, а ключ занятым. Следующий импорт приносит позицию с тем же
-- нормализованным названием, связывание строит для неё группу с тем же ключом
-- и падает:
--
--   SqliteError: UNIQUE constraint failed: products.match_key
--
-- Причём падает уже ПОСЛЕ записи позиций, в отдельной транзакции, поэтому
-- прайс оказывался загружен, а человек видел ошибку.
--
-- Изменить ограничение в SQLite нельзя, таблица пересобирается. Порядок
-- «создать новую → удалить старую → переименовать» выбран намеренно: если
-- переименовывать старую, SQLite перепишет ссылки на неё в items.
CREATE TABLE products_new (
  id         INTEGER PRIMARY KEY,
  title      TEXT    NOT NULL,
  match_key  TEXT,                    -- норм. артикул или название, по которому склеили
  created_by TEXT    NOT NULL DEFAULT 'auto' CHECK (created_by IN ('auto','manual'))
);

INSERT INTO products_new SELECT id, title, match_key, created_by FROM products;

DROP TABLE products;
ALTER TABLE products_new RENAME TO products;

-- Пустые ручные товары — те самые, что держали ключ. Автоматика их не
-- восстановит: связывать нечего.
DELETE FROM products
 WHERE created_by = 'manual'
   AND NOT EXISTS (SELECT 1 FROM items i WHERE i.product_id = products.id);
