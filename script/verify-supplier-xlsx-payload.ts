/**
 * Verifica que el flujo XLSX → base64 → buffer siga siendo un ZIP válido (.xlsx)
 * y que SheetJS pueda leerlo (mismo stack que /api/suppliers/export).
 */
import * as XLSX from "xlsx";

const wb = XLSX.utils.book_new();
const ws = XLSX.utils.json_to_sheet([
  { "Nombre Comercial": "Test", CUIT: "20123456789" },
]);
XLSX.utils.book_append_sheet(wb, ws, "Proveedores");

const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
if (buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
  throw new Error("El buffer generado no empieza con PK (no es ZIP/xlsx válido)");
}

const b64 = Buffer.from(buffer).toString("base64");
const round = Buffer.from(b64, "base64");
if (round[0] !== 0x50 || round[1] !== 0x4b) {
  throw new Error("Roundtrip base64 rompió el archivo");
}

XLSX.read(round, { type: "buffer" });
console.log("OK: xlsx generado, base64 roundtrip y XLSX.read sin errores.");
