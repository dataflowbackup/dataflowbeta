/** Texto único para mostrar / buscar comprobante (punto de venta + número). */

export function formatInvoiceVoucherDisplay(inv: {
  invoiceSalePoint?: string | null;
  invoiceNumber?: string | null;
}): string {
  const sp = inv.invoiceSalePoint?.trim() ?? "";
  const num = String(inv.invoiceNumber ?? "").trim();
  if (sp && /^\d{4}$/.test(sp) && /^\d{8}$/.test(num)) {
    return `${sp}-${num}`;
  }
  return num || sp || "—";
}
