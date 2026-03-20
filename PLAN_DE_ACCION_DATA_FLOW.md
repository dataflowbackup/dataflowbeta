-|---------|
| 2.2.1 | Revertir CPP | Al eliminar/corregir factura, recalcular CPP del insumo |
| 2.2.2 | Revertir stock | Deshacer movimiento de inventario |
| 2.2.3 | Revertir Cta Cte | Recalcular saldo del proveedor |
| 2.2.4 | Historial de cambios | Log inmutable de todas las modificaciones |

**Estimacion**: 6 horas

## 2.3 Pagos y Cuentas Corrientes (70% → 100%)

| ID | Tarea | Detalle |
|----|-------|---------|
| 2.3.1 | Grafico deuda | Pie chart % deuda por proveedor |
| 2.3.2 | Vista vencidos | Tabla separada de facturas vencidas |
| 2.3.3 | Filtro por local | Agrupar deuda por local |
| 2.3.4 | Alerta socios | Notificacion cuando factura vence (preparar para email) |

**Estimacion**: 5 horas

## 2.4 Extractos Bancarios (60% → 100%)

| ID | Tarea | Detalle |
|----|-------|---------|
| 2.4.1 | Indicador % categorizado | Mostrar progreso de categorizacion |
| 2.4.2 | Bloqueo hasta 100% | No permitir cerrar mes sin categorizar todo |
| 2.4.3 | Desglose neto/bruto | UI para reemplazar pago neto por movimientos brutos |
| 2.4.4 | Validacion balance cero | Al desglosar, suma debe dar cero |
| 2.4.5 | Estado Stand By | Marcar operaciones pendientes de completar |

**Estimacion**: 8 horas

**Subtotal Fase 2**: 27 horas

---

# FASE 3: COSTOS Y RECETAS
**Prioridad**: ALTA
**Dependencias**: Fase 2

## 3.1 Sub-Recetas (40% → 100%)

| ID | Tarea | Detalle |
|----|-------|---------|
| 3.1.1 | Campo `recipeType` | Enum: plato, subreceta, produccion |
| 3.1.2 | Categoria produccion | Categoria predeterminada para sub-recetas |
| 3.1.3 | Peso util expandido | Calculo: Costo Unitario = SUM(ingredientes) / pesoUtil |
| 3.1.4 | UI diferenciada | Formulario distinto para sub-recetas |

**Estimacion**: 4 horas

## 3.2 Platos/Fichas Tecnicas (60% → 100%)

| ID | Tarea | Detalle |
|----|-------|---------|
| 3.2.1 | Sub-recetas como ingrediente | FK `subRecipeId` en recipe_ingredients |
| 3.2.2 | Descripcion paso a paso | Campo expandido para instrucciones de cocina |
| 3.2.3 | Promedio CMV carta | Calcular CMV% promedio de todos los platos activos |
| 3.2.4 | Boton imprimir | Generar PDF con formato cocina |

**Estimacion**: 6 horas

## 3.3 Historial de Costos (50% → 100%)

| ID | Tarea | Detalle |
|----|-------|---------|
| 3.3.1 | Grafico evolucion | Line chart con rango de fechas |
| 3.3.2 | Top 10 insumos | Por volumen y por valor |
| 3.3.3 | Filtros avanzados | Por rubro, por proveedor, por periodo |

**Estimacion**: 5 horas

**Subtotal Fase 3**: 15 horas

---

# FASE 4: ESTADOS DE RESULTADOS
**Prioridad**: ALTA
**Dependencias**: Fase 2, Fase 3

## 4.1 EE.RR. Formal (40% → 100%)

| ID | Tarea | Detalle |
|----|-------|---------|
| 4.1.1 | Estructura formal | Ingresos - Gastos = Resultado por grupo |
| 4.1.2 | Subtotales por grupo | Suma de categorias dentro de cada grupo |
| 4.1.3 | Comparativo mensual | Ver varios meses lado a lado |
| 4.1.4 | Movimientos especiales | Inicio de mes, retiro socios con tratamiento diferenciado |
| 4.1.5 | Cierre de periodo | Bloquear meses cerrados |
| 4.1.6 | Exportacion PDF | Formato profesional para presentar |
| 4.1.7 | Exportacion Excel | Para analisis adicional |

**Estimacion**: 10 horas

**Subtotal Fase 4**: 10 horas

---

# FASE 5: SISTEMA DE PERMISOS
**Prioridad**: ALTA
**Dependencias**: Fase 0

## 5.1 Permisos Granulares (40% → 100%)

| ID | Tarea | Detalle |
|----|-------|---------|
| 5.1.1 | Tabla `roles` | id, name, description, isSystem |
| 5.1.2 | Roles predefinidos | Socio, Gerente, Encargado, Cajero, Mozo, Jefe Cocina, Contador |
| 5.1.3 | Permisos por modulo | Seed de todos los permisos CRUD por modulo |
| 5.1.4 | UI gestion roles | CRUD de roles personalizados |
| 5.1.5 | UI asignacion permisos | Matriz de checkboxes modulo x accion |
| 5.1.6 | Middleware validacion | Verificar permisos en cada endpoint |

**Estimacion**: 12 horas

**Subtotal Fase 5**: 12 horas

---

# FASE 6: POS - SISTEMA DE VENTAS
**Prioridad**: CRITICA (Core Business)
**Dependencias**: Fase 0, Fase 3, Fase 5

## 6.1 Estructura Base POS

| ID | Tarea | Detalle |
|----|-------|---------|
| 6.1.1 | Tabla `tables` | id, localId, name, capacity, status, positionX, positionY |
| 6.1.2 | Tabla `orders` | id, localId, tableId, waiterId, status, openedAt, closedAt |
| 6.1.3 | Tabla `orderItems` | id, orderId, recipeId, quantity, unitPrice, notes, status |
| 6.1.4 | Tabla `tickets` | id, orderId, ticketNumber, ticketType, total, paymentMethod, afipCAE |
| 6.1.5 | Tabla `cashClosings` | id, localId, userId, shift, expected, actual, difference |

**Estimacion**: 6 horas

## 6.2 UI POS

| ID | Tarea | Detalle |
|----|-------|---------|
| 6.2.1 | Mapa de mesas | Vista visual con estados (libre, ocupada, cuenta pedida) |
| 6.2.2 | Toma de pedido | Agregar items a comanda con notas |
| 6.2.3 | Gestion comanda | Enviar a cocina, marcar listo |
| 6.2.4 | Cobro | Seleccionar medio de pago, calcular vuelto |
| 6.2.5 | Ticket | Generar e imprimir ticket |
| 6.2.6 | Division cuenta | Dividir en partes iguales o por items |

**Estimacion**: 20 horas

## 6.3 Integracion Stock

| ID | Tarea | Detalle |
|----|-------|---------|
| 6.3.1 | Consumo teorico | Al facturar, descontar ingredientes segun receta |
| 6.3.2 | CMV por ticket | Registrar costo de cada venta |
| 6.3.3 | Alertas stock bajo | Notificar cuando insumo llega a minimo |

**Estimacion**: 6 horas

## 6.4 Cierres de Caja

| ID | Tarea | Detalle |
|----|-------|---------|
| 6.4.1 | Arqueo efectivo | Contar billetes y monedas |
| 6.4.2 | Desglose medios | Totales por efectivo, tarjeta, MP, etc |
| 6.4.3 | Diferencia | Calcular faltante/sobrante |
| 6.4.4 | Registro inmutable | No editable despues de cerrar |
| 6.4.5 | Historial | Ver cierres anteriores por cajero/fecha |

**Estimacion**: 8 horas

**Subtotal Fase 6**: 40 horas

---

# FASE 7: INTEGRACION AFIP
**Prioridad**: MEDIA (Requerido para produccion)
**Dependencias**: Fase 6

## 7.1 Factura Electronica

| ID | Tarea | Detalle |
|----|-------|---------|
| 7.1.1 | Integracion Afip.js | Configurar servicio intermediario |
| 7.1.2 | Solicitar CAE | Al generar ticket, obtener CAE de AFIP |
| 7.1.3 | Almacenar CAE/CAEVto | Campos en tabla tickets |
| 7.1.4 | QR fiscal | Generar QR segun normativa |
| 7.1.5 | Formato ticket fiscal | Layout segun requerimientos AFIP |

**Estimacion**: 15 horas

**Subtotal Fase 7**: 15 horas

---

# FASE 8: ALERTAS Y NOTIFICACIONES
**Prioridad**: MEDIA
**Dependencias**: Fase 2

## 8.1 Sistema de Alertas

| ID | Tarea | Detalle |
|----|-------|---------|
| 8.1.1 | Configuracion Resend | API key, templates |
| 8.1.2 | Template variacion costo | Email cuando CPP varia mas de X% |
| 8.1.3 | Template factura vencida | Email cuando factura pasa fecha vencimiento |
| 8.1.4 | Template stock bajo | Email cuando insumo llega a minimo |
| 8.1.5 | Preferencias usuario | Elegir que alertas recibir |
| 8.1.6 | Solo socios | Filtrar destinatarios por rol |

**Estimacion**: 8 horas

**Subtotal Fase 8**: 8 horas

---

# FASE 9: MODULOS ADICIONALES
**Prioridad**: BAJA
**Dependencias**: Fases anteriores

## 9.1 Punto de Equilibrio

| ID | Tarea | Detalle |
|----|-------|---------|
| 9.1.1 | Seleccion costos fijos | Elegir categorias que son costo fijo |
| 9.1.2 | Calculo PE unidades | Cuantas unidades de X producto para cubrir costos |
| 9.1.3 | Calculo PE monetario | Cuanto hay que facturar para cubrir costos |
| 9.1.4 | Grafico | Visualizacion del punto de equilibrio |

**Estimacion**: 6 horas

## 9.2 Comparacion Precios Proveedores

| ID | Tarea | Detalle |
|----|-------|---------|
| 9.2.1 | Tabla `supplierPrices` | insumoId, supplierId, price, date |
| 9.2.2 | Historial por proveedor | Ver evolucion de precio de un insumo |
| 9.2.3 | Comparativa | Tabla lado a lado de precios |

**Estimacion**: 5 horas

## 9.3 Auditoria Completa

| ID | Tarea | Detalle |
|----|-------|---------|
| 9.3.1 | Middleware auditoria | Loguear todas las acciones CUD |
| 9.3.2 | UI visualizacion | Ver historial de cambios por tabla/registro |
| 9.3.3 | Filtros | Por usuario, por fecha, por modulo |

**Estimacion**: 6 horas

**Subtotal Fase 9**: 17 horas

---

# RESUMEN DE ESFUERZO

| Fase | Descripcion | Horas | Prioridad |
|------|-------------|-------|-----------|
| 0 | Autenticacion Propia | 20h | CRITICA |
| 1 | Completar Core Data | 11h | ALTA |
| 2 | Flujo Financiero | 27h | CRITICA |
| 3 | Costos y Recetas | 15h | ALTA |
| 4 | Estados de Resultados | 10h | ALTA |
| 5 | Sistema de Permisos | 12h | ALTA |
| 6 | POS Sistema Ventas | 40h | CRITICA |
| 7 | Integracion AFIP | 15h | MEDIA |
| 8 | Alertas Email | 8h | MEDIA |
| 9 | Modulos Adicionales | 17h | BAJA |
| **TOTAL** | | **175h** | |

---

# ORDEN DE EJECUCION RECOMENDADO

```
SPRINT 1 (Semana 1-2): Fundamentos
├── Fase 0: Autenticacion (20h)
└── Fase 1: Core Data (11h)
    Total: 31h

SPRINT 2 (Semana 3-4): Flujo Financiero
├── Fase 2: Facturas, Pagos, Extractos (27h)
└── Fase 5: Permisos basicos (12h)
    Total: 39h

SPRINT 3 (Semana 5-6): Costos y Reportes
├── Fase 3: Recetas y Sub-recetas (15h)
└── Fase 4: EE.RR. formal (10h)
    Total: 25h

SPRINT 4 (Semana 7-9): POS
└── Fase 6: Sistema de Ventas completo (40h)
    Total: 40h

SPRINT 5 (Semana 10-11): Produccion
├── Fase 7: AFIP (15h)
├── Fase 8: Alertas (8h)
└── Migracion Supabase
    Total: 23h

SPRINT 6 (Semana 12+): Extras
└── Fase 9: Modulos adicionales (17h)
    Total: 17h
```

---

# HITOS DE VALIDACION

| Hito | Descripcion | Criterio de Exito |
|------|-------------|-------------------|
| H1 | Auth funcionando | Login/registro sin Replit Auth |
| H2 | Facturacion completa | Crear, editar, eliminar con reversiones |
| H3 | Recetas con sub-recetas | Calculos correctos con anidamiento |
| H4 | EE.RR. exportable | PDF profesional generado |
| H5 | POS operativo | Tomar pedido, cobrar, imprimir ticket |
| H6 | AFIP integrado | CAE obtenido exitosamente |
| H7 | Produccion | App corriendo en Supabase |

---

Documento generado: Diciembre 2024
Ultima actualizacion: Al confirmar decisiones arquitectonicas
