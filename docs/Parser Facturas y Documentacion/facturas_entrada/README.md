# Carpeta de ingreso — facturas (PDF e imágenes)

**Copiá acá las ~400 facturas** (un archivo por comprobante):

- **PDF** (recomendado para comprobantes ARCA/AFIP electrónicos): se procesa **solo la página 1**. Si algún comprobante tiene más de una página con datos, habría que partirlo antes.
- **Imágenes:** JPG, JPEG, PNG, WEBP.

Podés numerarlos (`001.pdf`, `002.pdf`, …) para orden estable en el Excel.

Esta carpeta **no se sube a Git** (está en `.gitignore`).

## Dependencias extra para PDF

Antes de correr el script (una sola vez):

```powershell
pip install pymupdf
```

(También necesitás `anthropic` y `openpyxl` como ya decía la guía.)

## Cuando termines de copiar los archivos

Desde la **raíz del repo** (`dataflow_proyecto`), con la API key cargada:

**PowerShell:**

```powershell
$env:ANTHROPIC_API_KEY="sk-ant-api03-..."
cd "c:\Users\mbedu\OneDrive\Escritorio\dataflow_proyecto"
python "docs/Parser Facturas y Documentacion/factura_parser.py" `
  --input "docs/Parser Facturas y Documentacion/facturas_entrada" `
  --output "docs/Parser Facturas y Documentacion/salida_parser/facturas_dataflow.xlsx" `
  --delay 1.5
```

Si se corta el proceso, retomá con `--resume-from N` (N = cantidad de archivos ya procesados con éxito según el log).

El Excel final queda en **`salida_parser/`** (ver README ahí).
