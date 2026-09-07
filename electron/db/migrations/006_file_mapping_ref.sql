-- Ссылка files.mapping_id без правила при удалении ломала удаление профиля.
--
-- Профиль разметки описывает, как читать файл, и удалять его отдельно от
-- прайсов — обычное дело: маска имени оказалась слишком широкой, профиль завели
-- по ошибке. Но связь была объявлена без ON DELETE, то есть NO ACTION, и
-- удаление профиля, на который ссылается хоть один загруженный файл, отвечало
-- «FOREIGN KEY constraint failed» — то есть почти всегда.
--
-- Правильное поведение — SET NULL: файл и его позиции остаются, теряется только
-- указание, каким профилем он был размечен. Код к этому готов: mappingId везде
-- объявлен как number | null, а переимпорт такого источника отвечает
-- «У источника ... нет профиля разметки».
--
-- Изменить ограничение в SQLite нельзя, таблица пересобирается. Порядок
-- «создать новую → удалить старую → переименовать» выбран намеренно: если
-- переименовывать старую, SQLite перепишет ссылки на неё в items и imports.
CREATE TABLE files_new (
  id          INTEGER PRIMARY KEY,
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  path        TEXT    NOT NULL,
  sheet       TEXT    NOT NULL,
  file_hash   TEXT,
  mtime       INTEGER,
  mapping_id  INTEGER REFERENCES mappings(id) ON DELETE SET NULL,
  UNIQUE(path, sheet)
);

INSERT INTO files_new SELECT id, supplier_id, path, sheet, file_hash, mtime, mapping_id FROM files;

DROP TABLE files;
ALTER TABLE files_new RENAME TO files;

CREATE INDEX idx_files_hash ON files(file_hash);
