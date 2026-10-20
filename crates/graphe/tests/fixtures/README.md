# Test fixtures

`bible.SQLite3` is a minimal MyBible-format Bible with generic names and
filler verse text. Tests that need a Bible module point at it so they run on
every machine and on CI without reading the developer's installed modules.

## What is inside

- Book `250` ("Fix1"), chapter 4, verses 1-17. `250` is the number that
  `i18n::find_book_by_abbrev("Ec")` resolves to; the scroll tests type `Ec 4`.
- Book `650` ("Fix2"), chapter 10, verses 1-39. `650` is
  `i18n::find_book_by_abbrev("Hb")`; the scroll tests type `Hb 10:26`.
- Verse text is filler ("palavra de teste" repeated) sized so verse rows span
  several lines and the scroll-offset assertions have real heights to measure.

## Regenerating

```bash
cd crates/graphe/tests/fixtures
rm -f bible.SQLite3
{
  echo "CREATE TABLE info (name TEXT, value TEXT);"
  echo "CREATE TABLE books (book_number INTEGER, short_name TEXT, long_name TEXT);"
  echo "CREATE TABLE verses (book_number INTEGER, chapter INTEGER, verse INTEGER, text TEXT);"
  echo "INSERT INTO info VALUES ('description', 'Fixture Bible');"
  echo "INSERT INTO books VALUES (250, 'Fix1', 'Fixture Book One');"
  echo "INSERT INTO books VALUES (650, 'Fix2', 'Fixture Book Two');"
  for v in $(seq 1 17); do
    text="Texto de teste $v. $(printf 'palavra de teste %.0s' $(seq 1 27))"
    echo "INSERT INTO verses VALUES (250, 4, $v, '$text');"
  done
  for v in $(seq 1 39); do
    text="Texto de teste $v. $(printf 'palavra de teste %.0s' $(seq 1 55))"
    echo "INSERT INTO verses VALUES (650, 10, $v, '$text');"
  done
} | sqlite3 bible.SQLite3
```

Keep the book numbers in sync with `graphe_domain::i18n` abbreviations; the
books-table names are decorative (the app renders book labels from i18n).
