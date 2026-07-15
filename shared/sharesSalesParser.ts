/**
 * Parsers del reporte de "Shares" (nuevo origen de ventas, junto a Fudo y Datalive).
 *
 * Hay dos archivos:
 *  1) Ventas económicas (VENTAS SHARES): montos por día. IMPORTANTE: el reporte parte cada día
 *     en 2 filas (dos puntos de venta / cajas, Pto.Vta 8 y 9); hay que SUMAR ambas para tener la
 *     venta bruta total del día. Columnas (0-based):
 *       A(0) Fecha  C(2) Venta Bruta  D(3) Efectivo  E(4) Tarjeta
 *       F(5) Efectivo Online  G(6) Oper. Online  H(7) MercadoPago
 *  2) Ventas de productos (Venta de Productos Shares): A(0) Fecha (con hora), B(1) Producto,
 *     C(2) Rubro/Categoría, E(4) Cantidad.
 *
 * Ambas hojas tienen cabecera en la fila 0 y datos desde la fila 1. Reutilizable en el browser.
 */

/** Convierte una fecha (string "DD/MM/YYYY[ HH:MM:SS]", ISO, o serial de Excel) a "YYYY-MM-DD". */
function toIsoDate(raw: unknown): string | null {
  if (raw == null) return null;
  if (typeof raw === "string") {
    const s = raw.trim();
    const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
    const dmy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); // ignora la hora si viene detrás
    if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
    return null;
  }
  if (typeof raw === "number" && raw > 40000) {
    const d = new Date(Date.UTC(1899, 11, 30) + raw * 86400000);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }
  return null;
}

function num(raw: unknown): number {
  if (raw == null || raw === "") return 0;
  if (typeof raw === "number") return raw;
  // Formato argentino "1.234.567,89" o simple. Se normaliza.
  const s = String(raw).trim().replace(/\./g, "").replace(",", ".");
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

export interface ParsedSharesDay {
  fecha: string;
  ventaTotal: number;
  ventaEfectivo: number;
  ventaTarjeta: number;
  ventaEfectivoOnline: number;
  ventaOperOnline: number;
  ventaMercadopago: number;
}

export interface SharesParseResult {
  days: ParsedSharesDay[];
  warnings: string[];
}

const V_FECHA = 0;
const V_TOTAL = 2;
const V_EFECTIVO = 3;
const V_TARJETA = 4;
const V_EFECTIVO_ONLINE = 5;
const V_OPER_ONLINE = 6;
const V_MERCADOPAGO = 7;

/** Parsea el Excel de ventas económicas de Shares. Suma las 2 filas del mismo día. */
export function parseSharesReport(rows: any[][]): SharesParseResult {
  const warnings: string[] = [];
  if (!rows || rows.length <= 1) {
    return { days: [], warnings: ["El archivo no tiene filas de datos."] };
  }

  const byDay = new Map<string, ParsedSharesDay>();

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.every((c: any) => c == null || c === "")) continue;

    // Saltar filas de totales/resumen (primera celda no es una fecha).
    const first = String(row[V_FECHA] ?? "").trim().toUpperCase();
    if (/TOTAL|TOTALES|RESUMEN|BALANCE/.test(first)) continue;

    const fecha = toIsoDate(row[V_FECHA]);
    if (!fecha) continue;

    if (!byDay.has(fecha)) {
      byDay.set(fecha, {
        fecha,
        ventaTotal: 0,
        ventaEfectivo: 0,
        ventaTarjeta: 0,
        ventaEfectivoOnline: 0,
        ventaOperOnline: 0,
        ventaMercadopago: 0,
      });
    }
    const e = byDay.get(fecha)!;
    e.ventaTotal += num(row[V_TOTAL]);
    e.ventaEfectivo += num(row[V_EFECTIVO]);
    e.ventaTarjeta += num(row[V_TARJETA]);
    e.ventaEfectivoOnline += num(row[V_EFECTIVO_ONLINE]);
    e.ventaOperOnline += num(row[V_OPER_ONLINE]);
    e.ventaMercadopago += num(row[V_MERCADOPAGO]);
  }

  const round2 = (n: number) => Math.round(n * 100) / 100;
  const days = Array.from(byDay.values())
    .map((d) => ({
      fecha: d.fecha,
      ventaTotal: round2(d.ventaTotal),
      ventaEfectivo: round2(d.ventaEfectivo),
      ventaTarjeta: round2(d.ventaTarjeta),
      ventaEfectivoOnline: round2(d.ventaEfectivoOnline),
      ventaOperOnline: round2(d.ventaOperOnline),
      ventaMercadopago: round2(d.ventaMercadopago),
    }))
    .sort((a, b) => a.fecha.localeCompare(b.fecha));

  if (days.length === 0) warnings.push("No se encontraron filas de ventas válidas.");
  return { days, warnings };
}

export interface ParsedSharesProducto {
  fecha: string;
  producto: string;
  categoria: string;
  cantidad: number;
}

export interface SharesProductsParseResult {
  items: ParsedSharesProducto[];
  warnings: string[];
}

const P_FECHA = 0;
const P_PRODUCTO = 1;
const P_CATEGORIA = 2;
const P_CANTIDAD = 4;

/** Parsea el Excel de productos vendidos de Shares. Agrupa por (fecha, producto) sumando cantidad. */
export function parseSharesProductsReport(rows: any[][]): SharesProductsParseResult {
  const warnings: string[] = [];
  if (!rows || rows.length <= 1) {
    return { items: [], warnings: ["El archivo no tiene filas de datos."] };
  }

  const byKey = new Map<string, ParsedSharesProducto>();

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.every((c: any) => c == null || c === "")) continue;

    const fecha = toIsoDate(row[P_FECHA]);
    if (!fecha) continue;

    const producto = String(row[P_PRODUCTO] ?? "").trim();
    if (!producto) continue;
    const categoria = String(row[P_CATEGORIA] ?? "").trim();
    const cantidad = Math.round(num(row[P_CANTIDAD]));

    const key = `${fecha}||${producto}`;
    if (byKey.has(key)) {
      byKey.get(key)!.cantidad += cantidad;
    } else {
      byKey.set(key, { fecha, producto, categoria, cantidad });
    }
  }

  if (byKey.size === 0) warnings.push("No se encontraron productos válidos en el archivo.");
  return { items: Array.from(byKey.values()), warnings };
}
