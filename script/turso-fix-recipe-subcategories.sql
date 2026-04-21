-- =============================================================================
-- Parche Turso / LibSQL: subcategorias de receta + columna subcategory_id
-- =============================================================================
-- Sintomas en la app (Netlify): 500 en /api/recipes, /api/recipes/stats,
--   /api/recipe-subcategories con:
--   - SQLITE_UNKNOWN: no such table: recipe_subcategories
--   - SQL_INPUT_ERROR: no such column: subcategory_id
--
-- Requisito: debe existir la tabla `recipe_categories` (y `clients`).
--
-- Como aplicarlo (elegi una):
--   A) Turso Dashboard → base de datos → SQL → pegar y ejecutar todo el bloque.
--   B) Desde la PC (con .env que apunta a Turso):
--        npm run db:push:turso
--      Eso sincroniza todo el schema Drizzle con la base remota (recomendado).
--
-- Si algun ALTER falla con "duplicate column name", esa columna ya existe:
--   comenta esa linea y volve a ejecutar.
-- =============================================================================

CREATE TABLE IF NOT EXISTS recipe_subcategories (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  client_id INTEGER NOT NULL,
  recipe_category_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  display_order INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE ON UPDATE NO ACTION,
  FOREIGN KEY (recipe_category_id) REFERENCES recipe_categories(id) ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE INDEX IF NOT EXISTS recipe_subcategories_client_id_idx ON recipe_subcategories(client_id);
CREATE INDEX IF NOT EXISTS recipe_subcategories_recipe_category_id_idx ON recipe_subcategories(recipe_category_id);

-- Columna esperada por Drizzle en `recipes` (NULL hasta que asignen subcategoria en la app)
ALTER TABLE recipes ADD COLUMN subcategory_id INTEGER;
