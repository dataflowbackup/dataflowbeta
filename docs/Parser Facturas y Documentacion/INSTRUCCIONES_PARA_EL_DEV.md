# INSTRUCCIONES PARA EL DEV — PARSER DE FACTURAS ESCANEADAS
## Proyecto: DataFlow | Tarea puntual y acotada, completamente aislada del sistema en vivo

---

## ⚠️ AVISO IMPORTANTE ANTES DE EMPEZAR

**Este script NO toca, NO modifica, NO se conecta y NO interfiere en absolutamente nada con el proyecto DataFlow existente.**

DataFlow está en producción y en uso activo por los socios. Esta tarea es 100% externa y aislada:
- Corre en tu máquina local (o en cualquier entorno separado)
- No requiere acceso al servidor de DataFlow
- No requiere acceso a la base de datos de DataFlow
- No requiere acceso al repositorio de DataFlow
- El output es únicamente un archivo Excel (.xlsx) que después se usará como insumo para diseñar el importador, pero eso es una tarea futura y separada

**No hay ningún riesgo de pisar ni afectar nada del sistema en vivo.**

---

## ¿QUÉ HACE ESTE SCRIPT?

Es un parser automático de facturas escaneadas. Recibe una carpeta con imágenes de facturas argentinas (JPG/PNG), las procesa una por una enviándolas a la API de Claude (IA de Anthropic) para que las "lea" y extraiga los datos, y genera un archivo Excel estructurado con toda la información.

**Flujo:**
```
Carpeta con imágenes de facturas
        ↓
  factura_parser.py
        ↓
  API de Anthropic (Claude Vision lee cada imagen)
        ↓
  Excel con 4 hojas:
  - "Facturas"          → una fila por factura (cabecera + totales)
  - "Items de Facturas" → una fila por ítem/producto dentro de cada factura
  - "Impuestos"         → una fila por impuesto dentro de cada factura
  - "Log de Errores"    → archivos que fallaron para revisar manualmente
```

**Datos que extrae por factura:**
- Punto de Venta y Número de Comprobante
- Fecha de Emisión
- Tipo de Comprobante (Factura A, Factura B, Remito, Nota de Crédito, etc.)
- Nombre Comercial del Proveedor
- Razón Social y CUIT
- Condición frente al IVA
- Subtotal Neto, Descuento, Total Impuestos, Total Final
- Detalle de ítems: descripción, cantidad, unidad de medida, precio unitario, subtotal
- Impuestos detallados: IVA 21%, IVA 10.5%, Percepciones IIBB, etc.

---

## PASO 1 — REQUISITOS DE ENTORNO

Este script corre en Python. Necesitás tener instalado:

- **Python 3.8 o superior**
  Verificar con: `python3 --version`
  Si no lo tenés: https://www.python.org/downloads/

- **Dos librerías Python** (se instalan con un solo comando, ver Paso 3)

---

## PASO 2 — OBTENER LA API KEY DE ANTHROPIC

El script usa la API de Claude (Anthropic) para leer las imágenes. Necesitás una API Key.

1. Ir a: **https://console.anthropic.com**
2. Crear una cuenta (o iniciar sesión si ya tienen una)
3. Ir a **"API Keys"** en el menú lateral
4. Crear una nueva key → copiarla y guardarla (se muestra solo una vez)
5. Ir a **"Billing"** y cargar saldo — con **USD $20 alcanza** para procesar las ~400 facturas

> ⚠️ La API Key es como una contraseña. No la subas a ningún repositorio ni la compartas por canales inseguros. Usala solo como variable de entorno (ver Paso 4).

---

## PASO 3 — INSTALAR LAS DEPENDENCIAS

Abrir una terminal y correr:

```bash
pip install anthropic openpyxl pymupdf
```

(`pymupdf` hace falta si procesás **PDF**: rasteriza la página 1 a imagen para Claude Vision.)

Si usás Python 3 en un sistema donde `pip` apunta a Python 2, usar:

```bash
pip3 install anthropic openpyxl pymupdf
```

---

## PASO 4 — CONFIGURAR LA API KEY

La API Key se configura como variable de entorno, **nunca hardcodeada en el código**.

**En Mac/Linux (terminal):**
```bash
export ANTHROPIC_API_KEY="sk-ant-api03-XXXXXXXXXXXXXXXXXXXX"
```

**En Windows (PowerShell):**
```powershell
$env:ANTHROPIC_API_KEY="sk-ant-api03-XXXXXXXXXXXXXXXXXXXX"
```

**En Windows (CMD):**
```cmd
set ANTHROPIC_API_KEY=sk-ant-api03-XXXXXXXXXXXXXXXXXXXX
```

> Este comando dura solo mientras la terminal esté abierta. Si cerrás y volvés a abrir, hay que repetirlo. Si querés que sea permanente, agregarlo a las variables de entorno del sistema operativo.

---

## PASO 5 — PREPARAR LAS IMÁGENES / PDF DE FACTURAS

- **PDF:** un archivo por factura (comprobantes electrónicos ARCA/AFIP suelen ser PDF de una página; el script usa **solo la página 1**).
- **O imágenes:** una por factura (JPG o PNG).
- Todas en una misma carpeta, por ejemplo: `./facturas/`
- Nombres sugeridos: `001.jpg`, `002.jpg`, etc. (para que el Excel quede ordenado)
- Resolución mínima recomendada: 300 DPI
- Si tenés PDFs de múltiples páginas, avisarle al dueño del proyecto para resolver eso por separado

**Estructura de carpeta recomendada:**
```
proyecto_facturas/
├── factura_parser.py       ← el script
├── README.md               ← este archivo
└── facturas/               ← carpeta con todas las imágenes
    ├── 001.jpg
    ├── 002.jpg
    ├── 003.jpg
    └── ...
```

---

## PASO 6 — CORRER EL SCRIPT

**Caso estándar — procesar toda una carpeta:**
```bash
python factura_parser.py --input ./facturas/ --output facturas_dataflow.xlsx
```

**Con delay mayor entre facturas** (recomendado si son 400+, para no saturar la API):
```bash
python factura_parser.py --input ./facturas/ --output facturas_dataflow.xlsx --delay 1.5
```

**Si el proceso se interrumpió y querés retomarlo** (por ejemplo, ya procesó 150, saltear esas):
```bash
python factura_parser.py --input ./facturas/ --output facturas_dataflow.xlsx --resume-from 150
```

**Probar con una sola factura primero** (recomendado antes de correr las 400):
```bash
python factura_parser.py --input ./facturas/001.jpg --output prueba.xlsx
```

---

## PASO 7 — QUÉ VER EN LA CONSOLA MIENTRAS CORRE

El script va mostrando el progreso en tiempo real. Ejemplo de salida esperada:

```
────────────────────────────────────────────────────────────
  DATAFLOW — PARSER DE FACTURAS
────────────────────────────────────────────────────────────
  Archivos encontrados: 400
  Output: facturas_dataflow.xlsx
  Delay entre facturas: 1.5s
────────────────────────────────────────────────────────────

[  1/400] Procesando: 001.jpg ... ✓  FACTURA A | Proveedor XYZ | $125000.50 | 8 ítems
[  2/400] Procesando: 002.jpg ... ✓  FACTURA A | Proveedor ABC | $43200.00 | 3 ítems
[  3/400] Procesando: 003.jpg ... ✗  ERROR: ...
  → Guardado parcial: facturas_dataflow_parcial_10.xlsx
...
```

**Guardado automático parcial:** cada 10 facturas el script guarda un Excel intermedio (`*_parcial_10.xlsx`, `*_parcial_20.xlsx`, etc.) para no perder progreso si el proceso se interrumpe.

---

## PASO 8 — RESULTADO FINAL

Al terminar, vas a tener un archivo `facturas_dataflow.xlsx` con estas 4 hojas:

| Hoja | Descripción |
|------|-------------|
| **Facturas** | Una fila por factura con todos los datos de cabecera y totales |
| **Items de Facturas** | Una fila por ítem/producto dentro de cada factura |
| **Impuestos** | Una fila por impuesto (IVA, percepciones, etc.) por factura |
| **Log de Errores** | Archivos que fallaron — para revisar manualmente o reprocesar |

Este Excel es el entregable final de esta tarea. Enviárselo al dueño del proyecto.

---

## POSIBLES ERRORES Y SOLUCIONES

| Error | Causa probable | Solución |
|-------|---------------|----------|
| `anthropic not found` | Librería no instalada | `pip install anthropic` |
| `AuthenticationError` | API Key incorrecta o no seteada | Verificar `ANTHROPIC_API_KEY` |
| `RateLimitError` | Demasiadas requests seguidas | Aumentar `--delay 2` o `--delay 3` |
| `OverloadedError` | API de Anthropic saturada | Esperar unos minutos y retomar con `--resume-from N` |
| JSON parse error | La factura es ilegible o muy borrosa | Ver hoja "Log de Errores", revisar esa imagen manualmente |
| Imagen en blanco / error visual | Mala calidad del escaneo | Re-escanear esa factura y reprocesar |

---

## PREGUNTAS PARA EL DEV — INTEGRACIÓN FUTURA CON DATAFLOW

*(Estas preguntas son para una tarea futura y separada: construir el importador dentro de DataFlow que lea este Excel y cargue las facturas en el sistema. No es parte de esta tarea actual.)*

1. **¿Cuál es el stack tecnológico de DataFlow?** (lenguaje del backend, framework, base de datos)
2. **¿Dónde está hosteado?** (servidor propio, AWS, Vercel, Railway, otro)
3. **¿Tienen una API REST o GraphQL interna** que ya manejen compras/facturas/proveedores?
4. **¿Las tablas de Proveedores e Insumos ya están cargadas** en la base de datos, o también están vacías?
5. **¿Cómo querés que maneje los duplicados?** Si una factura del Excel ya existe en el sistema (mismo número de comprobante + proveedor), ¿la ignora, la actualiza o avisa?
6. **¿El importador va a ser una pantalla dentro de DataFlow** (drag & drop del Excel) o una herramienta separada para correr una sola vez?

---

## RESUMEN EJECUTIVO PARA EL DEV

> Corrés `factura_parser.py` apuntando a una carpeta con ~400 imágenes JPG de facturas. El script las manda a la API de Claude (IA), que las lee y extrae los datos. Al final obtenés un Excel con todo estructurado. Eso es todo. No tocar nada de DataFlow. El Excel se lo entregás al cliente y listo.

---

*Generado para el proyecto DataFlow — Mayo 2026*
