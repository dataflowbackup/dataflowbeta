# Salida del parser — Excel

Aquí queda el Excel cuando corrés el parser (o `ejecutar_parser.ps1` en la carpeta padre).

**Ruta típica en tu PC:**

`docs\Parser Facturas y Documentacion\salida_parser\facturas_dataflow.xlsx`

Ese archivo es el que subís en Dataflow → **Importar Excel (facturas)** → paso 1.

Archivos generados por `factura_parser.py`, por ejemplo:

- `facturas_dataflow.xlsx` — libro final con hojas **Facturas**, **Items de Facturas**, **Impuestos**, **Log de Errores**
- Archivos `*_parcial_*.xlsx` — guardados automáticos cada 10 facturas (mientras corre el script)

Esta carpeta **no se sube a Git** (está en `.gitignore`).
