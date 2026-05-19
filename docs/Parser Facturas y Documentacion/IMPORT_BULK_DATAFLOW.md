# Import masivo OCR — qué hace cada cosa (simple)

## Por qué antes sonaba “raro”

El sistema necesita saber **qué insumo de Dataflow** corresponde a **cada texto** que salió en la factura (ej. “Aceitunas N4” vs el nombre en tu catálogo).  
Eso **solo vos** lo podés validar cuando el texto es ambiguo.

**Todo lo demás** (factura, proveedor, pagos si dice PAGADA, duplicados, local FELISA, etc.) lo resuelve el backend cuando se ejecuta el **commit**.

---

## ¿En dónde se cotejan los insumos?

En el archivo Excel **`revision_insumos.xlsx`**.

Se genera así (logueado como Bruno, con `BULK_INVOICE_ADMIN_EMAILS` configurado):

1. Subís el Excel que salió del **parser** (`facturas_dataflow.xlsx`).
2. Pedís el precheck **con descarga Excel**: misma URL que el precheck pero con **`?format=xlsx`** en la dirección.

Te baja un libro con:

| Hoja | Para qué sirve |
|------|----------------|
| **`Revision_insumos`** | Acá cotejás: cada **descripción** que apareció en las facturas, el **insumo sugerido**, el **score**, el estado **auto/review**, y la columna **`ID insumo definitivo`** para corregir a mano si hace falta. |
| **`Instrucciones`** | Texto corto de cómo completar la revisión. |

**Reglas rápidas:**

- **`Estado = review`**: tenés que poner un número en **`ID insumo definitivo`** (el id del insumo en Dataflow, como en el listado de insumos).
- **`Estado = auto`**: si te parece bien la sugerencia, **dejá vacío** “ID insumo definitivo” (el sistema usa la sugerida). Si está mal, igual completá el id correcto.
- **No modifiques** el texto de la primera columna (es la clave del import).

Cuando termines, guardás ese archivo.

---

## Quién dispara el import final (“commit”)

Tiene que hacerlo **quien tenga sesión web de admin** en tu entorno (en la práctica vos con la cuenta de Bruno), porque usa cookies de login — yo desde acá no puedo “apretar el botón” en tu servidor.

Se suben **dos** archivos en el mismo pedido:

- **`file`**: Excel del parser (`facturas_dataflow.xlsx`).
- **`revision`**: el `revision_insumos.xlsx` que completaste.

Primero conviene **`dryRun=true`** (solo simula y lista errores sin grabar).

*(Si más adelante querés, se puede agregar una pantalla en Dataflow con dos botones “Descargar revisión” y “Importar” para no usar Postman/curl.)*

---

## Resumen de roles

| Quién | Qué |
|-------|-----|
| **Vos** | Revisar **`revision_insumos.xlsx`** (solo las filas dudosas o las que quieras corregir). |
| **Sistema / dev** | Parser Python, generación de `revision_insumos.xlsx`, commit con proveedor/local/pagos/duplicados. |
