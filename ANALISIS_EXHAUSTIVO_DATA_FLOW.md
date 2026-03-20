# Analisis Exhaustivo: Data Flow 5.0 vs Estado Actual

## Metodologia
Comparacion campo por campo, modulo por modulo, entre el documento "Data_Flow_5.0" y el schema actual (`shared/schema.ts`).

---

# SECCION 1: REQUISITOS DE ACCESO Y AUTENTICACION

## 1.1 Interfaz de Login

| Requisito Documento | Estado Actual | Brecha |
|---------------------|---------------|--------|
| Login por Username + Password (staff operativo, POS) | NO EXISTE | Usamos Replit Auth (OIDC) exclusivamente |
| Login por Email + Password (gerencia/socios) | NO EXISTE | Usamos Replit Auth (OIDC) exclusivamente |
| Passwords con cifrado fuerte (hash) | NO EXISTE | No hay tabla de passwords ni hashing |

**Impacto**: CRITICO. El documento requiere autenticacion dual propia. Replit Auth no soporta login por username.

---

## 1.2 Estructura de Roles y Permisos

| Requisito Documento | Estado Actual | Brecha |
|---------------------|---------------|--------|
| Tabla Roles vinculada a Permisos | PARCIAL | Tenemos `permissions` y `rolePermissions` |
| Permisos booleanos CRUD por modulo | SI EXISTE | `canView`, `canCreate`, `canEdit`, `canDelete` en `rolePermissions` |
| Perfiles: Socio, Gerente, Cajero, Mozo, Jefe Cocina, Encargado Compras, Contador Externo | PARCIAL | Solo tenemos rol generico en `userClients.role` |

**Estructura Actual de Permisos**:
```
permissions: id, code, name, module, description, active
rolePermissions: id, clientId, role, permissionId, canView, canCreate, canEdit, canDelete
```

**Lo que falta**:
- Tabla `roles` separada con definicion de cada perfil
- Asociacion de permisos predefinidos por perfil
- UI de gestion completa de roles y permisos

---

# SECCION 2: FASE 1 - DATOS MAESTROS (CORE DATA)

## 2.1 Unidades de Medida

| Campo Documento | Campo Actual | Estado |
|-----------------|--------------|--------|
| Crear y gestionar unidades (kg, lts, unidad, etc.) | `unitsOfMeasure` | OK |
| Nombre | `name` | OK |
| Abreviatura | `abbreviation` | OK |
| Estado activo | `active` | OK |

**Tabla Actual**: `unitsOfMeasure` (id, clientId, name, abbreviation, active)

**Estado**: COMPLETO para requisitos basicos

---

## 2.2 Rubros de Insumos

| Campo Documento | Campo Actual | Estado |
|-----------------|--------------|--------|
| Hasta 25 categorias | Sin limite definido | OK (flexible) |
| Clasificar Materia Prima (Lacteos, Carnes, Verduras) | `rubros` | OK |
| Nombre | `name` | OK |
| Descripcion | `description` | OK |
| Estado activo | `active` | OK |

**Tabla Actual**: `rubros` (id, clientId, name, description, active, createdAt)

**Estado**: COMPLETO

---

## 2.3 Impuestos

| Campo Documento | Campo Actual | Estado |
|-----------------|--------------|--------|
| Base desplegable de TODOS los impuestos del pais | NO | Falta catalogo maestro precargado |
| Seleccion de cuales utiliza el cliente | `active` | PARCIAL - existe pero falta catalogo base |
| Nombre | `name` | OK |
| Porcentaje | `percentage` | OK |
| Tipo (IVA, percepciones, etc.) | `type` | OK |

**Tabla Actual**: `taxes` (id, clientId, name, percentage, type, active, createdAt)

**Lo que falta**:
- Catalogo maestro nacional de impuestos (IVA 21%, 10.5%, 27%, IIBB, etc.)
- Al crear cliente, precargar impuestos del pais
- Permitir al cliente activar/desactivar cuales usa

---

## 2.4 Proveedores

| Campo Documento | Campo Actual | Estado |
|-----------------|--------------|--------|
| Nombre | NO EXPLICITO | FALTA - tenemos `businessName` |
| Razon Social | `businessName` | OK (aunque el nombre es ambiguo) |
| CUIT | `cuit` | OK |
| Email | `email` | OK |
| Telefono | `phone` | OK |
| Plazo de Pago (dias) | `paymentDays` | OK |
| Direccion | `address` | OK (campo extra) |

**Tabla Actual**: `suppliers` (id, clientId, businessName, cuit, email, phone, address, paymentDays, active, createdAt, updatedAt)

**Lo que falta**:
- Campo separado para "Nombre Comercial" vs "Razon Social"
- Condicion IVA del proveedor (Responsable Inscripto, Monotributista, Exento)
- Validacion de CUIT formato y digito verificador

---

## 2.5 Insumos

| Campo Documento | Campo Actual | Estado |
|-----------------|--------------|--------|
| Nombre | `name` | OK |
| Rubro (desplegable) | `rubroId` FK a rubros | OK |
| Unidad de Medida (desplegable) | `unitOfMeasureId` FK | OK |

**Tabla Actual**: `supplies` (id, clientId, name, rubroId, unitOfMeasureId, lastCost, lastQuantity, unitCost, active, createdAt, updatedAt)

**Campos adicionales que tenemos** (no en documento pero utiles):
- `lastCost`, `lastQuantity`, `unitCost` para CPP

**Estado**: COMPLETO para requisitos basicos

---

## 2.6 Locales

| Campo Documento | Campo Actual | Estado |
|-----------------|--------------|--------|
| Nombre del local | `name` | OK |
| Razon Social | NO EXISTE | FALTA |
| CUIT | `cuit` | OK |
| Punto de Venta AFIP | NO EXISTE | FALTA |
| Direccion | `address` | OK (extra) |

**Tabla Actual**: `locals` (id, clientId, name, address, cuit, active, createdAt, updatedAt)

**Lo que falta**:
- `businessName` - Razon Social separada del nombre
- `afipPOS` - Punto de Venta AFIP (numero de 4 digitos)

---

## 2.7 Grupos y Categorias para Estados de Resultado

| Campo Documento | Campo Actual | Estado |
|-----------------|--------------|--------|
| Hasta 15 Grupos para EE.RR. | `categoryGroups` | OK |
| Categorias ilimitadas (Ingreso/Egreso) | `transactionCategories` | OK |
| Asignadas a un Grupo | `groupId` FK | OK |
| Movimientos especiales (Inicio de Mes, Retiro) | NO EXISTE | FALTA |

**Tablas Actuales**:
```
categoryGroups: id, clientId, name, type, order, active
transactionCategories: id, clientId, groupId, name, type, isDefault, active, createdAt
```

**Lo que falta**:
- Campo `isSpecial` o `specialType` para identificar movimientos especiales
- Logica especial para "Inicio de Mes" y "Retiro de Socios"
- Tratamiento diferenciado en EE.RR.

---

## 2.8 Saldos (Entidades Bancarias y Billeteras)

| Campo Documento | Campo Actual | Estado |
|-----------------|--------------|--------|
| Definicion de entidades bancarias | `bankAccounts` | OK |
| Billeteras virtuales | `type` = 'wallet' | OK |
| Nombre | `name` | OK |
| Tipo (bank, wallet) | `type` | OK |
| Numero de cuenta | `accountNumber` | OK |

**Tabla Actual**: `bankAccounts` (id, clientId, name, type, accountNumber, active, createdAt)

**Estado**: COMPLETO

---

# SECCION 3: FASE 2 - FLUJO FINANCIERO, COMPRAS Y PRODUCCION

## 3.1 MODULO: Carga de Facturas

### 3.1.1 Input de Cabecera

| Campo Documento | Campo Actual | Estado |
|-----------------|--------------|--------|
| Seleccion de Local | `localId` | OK |
| Seleccion de Proveedor | `supplierId` | OK |
| Fecha | `invoiceDate` | OK |
| Tipo de Comprobante | `invoiceType` | OK |
| Numero de Comprobante | `invoiceNumber` | OK |
| Condicion IVA (autocargar desde Maestro) | `ivaCondition` | PARCIAL - no autocarga |
| Plazo de Pago (autocargar desde Proveedor) | NO AUTOCARGA | FALTA logica |
| Calculo Vencimiento: Fecha + Plazo | `dueDate` | EXISTE pero falta CALCULO AUTOMATICO |

**Lo que falta**:
- Al seleccionar proveedor, autocargar `ivaCondition` y `paymentDays`
- Calcular automaticamente `dueDate = invoiceDate + paymentDays`

### 3.1.2 Input Detallado (Items)

| Campo Documento | Campo Actual | Estado |
|-----------------|--------------|--------|
| Cargar Insumo | `supplyId` | OK |
| Cantidad | `quantity` | OK |
| Subtotal | `subtotal` | OK |
| Regla de Conversion U.M. | NO EXISTE | FALTA |
| Rubro autorelleno desde Insumo (editable) | `rubroId` | PARCIAL - existe pero no autorellena |

**Tabla Actual**: `invoiceItems` (id, invoiceId, supplyId, description, quantity, unitPrice, subtotal, rubroId)

**Lo que falta**:
- Conversiones de unidades (ej: compro en cajas, registro en unidades)
- Autorelleno del rubro al seleccionar insumo

### 3.1.3 Input de Pago en el Momento

| Campo Documento | Campo Actual | Estado |
|-----------------|--------------|--------|
| Registrar monto pagado al cargar factura | `advancePayment` | OK |
| Saldo restante a Cta. Cte. | `balance` | OK |

**Estado**: COMPLETO

### 3.1.4 Ejecucion Critica (Al Guardar)

| Requisito Documento | Estado Actual | Brecha |
|---------------------|---------------|--------|
| Calculo CPP (Costo Promedio Ponderado) | PARCIAL | Usamos "ultima compra", no CPP real |
| Actualizar cantidad en Stock | EXISTE | `stockMovements` pero falta integracion automatica |
| ALARMA: Si nuevo CPP supera anterior por % configurable | NO EXISTE | FALTA |
| Mostrar tabla Costo Anterior vs Nuevo | NO EXISTE | FALTA |

**Lo que falta**:
- Implementar formula real de CPP: `(Stock Actual * Costo Actual + Cantidad Nueva * Costo Nuevo) / (Stock Actual + Cantidad Nueva)`
- Generar alerta cuando variacion > umbral configurable
- UI comparativa de costos

### 3.1.5 Gestion de Facturas

| Requisito Documento | Estado Actual | Brecha |
|---------------------|---------------|--------|
| Buscar facturas | OK | Tenemos listado con filtros |
| Corregir facturas | PARCIAL | Existe PATCH pero sin recalculos |
| Eliminar facturas | EXISTE | Falta REVERSION completa |
| Recalcular y revertir CPP al corregir/eliminar | NO EXISTE | CRITICO - FALTA |
| Revertir Inventario al corregir/eliminar | NO EXISTE | CRITICO - FALTA |
| Revertir Cta. Cte. al corregir/eliminar | NO EXISTE | CRITICO - FALTA |

### 3.1.6 Alertas de Facturas

| Requisito Documento | Estado Actual | Brecha |
|---------------------|---------------|--------|
| Alarma Facturas Faltantes (emitidas en AFIP no cargadas) | NO EXISTE | Requiere integracion AFIP |

---

## 3.2 MODULO: Pagos y Cuentas Corrientes

### 3.2.1 Imputacion de Pagos

| Campo Documento | Campo Actual | Estado |
|-----------------|--------------|--------|
| Seleccionar Local | `localId` | OK |
| Seleccionar Proveedor | `supplierId` | OK |
| Medio de Pago | `paymentMethod` | OK |
| Importe | `amount` | OK |
| Seleccionar Facturas a saldar | `paymentAllocations` | OK |
| Pago parcial o total | FK a invoices | OK |
| Actualizar saldo factura | logica en routes | PARCIAL |
| Marcar como "Saldada" cuando saldo = 0 | `paid = true` | OK |

**Tablas Actuales**:
```
payments: id, clientId, localId, supplierId, paymentNumber, paymentDate, paymentMethod, amount, notes, createdBy, createdAt
paymentAllocations: id, paymentId, invoiceId, amount
```

**Estado**: MAYORMENTE COMPLETO

### 3.2.2 Visualizacion de Deuda (Graficos)

| Requisito Documento | Estado Actual | Brecha |
|---------------------|---------------|--------|
| Grafico de % Deuda Total por Proveedor | NO EXISTE | FALTA |

### 3.2.3 Visualizacion de Deuda (Detalle)

| Requisito Documento | Estado Actual | Brecha |
|---------------------|---------------|--------|
| Total Pendiente por Proveedor | EXISTE | `/api/supplier-accounts` |
| Total Pendiente por Local | NO EXISTE | FALTA filtro/agrupacion |
| Vista separada de Deuda VENCIDA | NO EXISTE | FALTA |
| ALARMA: Notificar a Socios facturas vencidas | NO EXISTE | FALTA |

---

## 3.3 GRUPO: Costos y Recetas

### 3.3.1 Categorias de Platos

| Campo Documento | Campo Actual | Estado |
|-----------------|--------------|--------|
| Crear/gestionar estructura carta | `recipeCategories` | OK |
| Ej: Entradas, Pastas, Bebidas | `name` | OK |
| Descripcion | `description` | OK |

**Tabla Actual**: `recipeCategories` (id, clientId, name, description, active, createdAt)

**Estado**: COMPLETO

### 3.3.2 Creacion de Sub-Recetas

| Campo Documento | Campo Actual | Estado |
|-----------------|--------------|--------|
| Nombre | `name` | OK |
| Categoria "Produccion" por defecto | `categoryId` | FALTA categoria predeterminada |
| Insumos de Materia Prima | `recipeIngredients` | OK |
| Descripcion Paso a Paso (NUEVO) | `description` | EXISTE pero no usado para esto |
| Peso Util Final | `usefulYield` | EXISTE en recipes |
| Calculo Merma | `wastePercentage` en ingredients | PARCIAL |

**Calculo requerido**:
```
Costo Unitario Sub Receta = SUM(Cantidad Usada * CPP Insumo) / Peso Util Final
```

**Lo que falta**:
- Diferenciar Sub-Recetas de Platos (campo `isSubRecipe` o `recipeType`)
- Categoria "Produccion" predeterminada para sub-recetas
- Campo descripcion expandido para "Paso a Paso"

### 3.3.3 Creacion de Platos (Ficha Tecnica)

| Campo Documento | Campo Actual | Estado |
|-----------------|--------------|--------|
| Composicion con insumos y/o Sub-Recetas | PARCIAL | Solo soporta insumos, no sub-recetas como ingredientes |
| Precio de Venta (con IVA) | `salePriceWithTax` | OK |
| Descripcion Paso a Paso | `description` | EXISTE |
| CMV% | `cmvPercentage` | OK |
| Margen | `margin` | OK |
| Markup | `markup` | OK |
| Promedio % Costo Carta Total | NO EXISTE | FALTA |
| Boton "Imprimir Receta" | NO EXISTE | FALTA |

**Lo que falta**:
- Permitir agregar sub-recetas como ingredientes (FK a otra receta)
- Calcular promedio de CMV% entre todos los platos activos
- Funcionalidad de impresion con formato cocina

### 3.3.4 Evolucion del Costo Historico

| Campo Documento | Campo Actual | Estado |
|-----------------|--------------|--------|
| Grafico con rango de fechas | PARCIAL | Datos existen, grafico parcial |
| Top 10 Materia Prima mas comprada | NO EXISTE | FALTA |
| Filtro por volumen o valor | NO EXISTE | FALTA |

**Tabla Actual**: `costHistory` (id, supplyId, invoiceId, unitCost, quantity, totalCost, recordedAt)

**Estado**: Datos existen, falta UI avanzada

---

## 3.4 GRUPO: Extractos Bancarios y Categorizacion

### 3.4.1 Inyeccion de Extractos

| Campo Documento | Campo Actual | Estado |
|-----------------|--------------|--------|
| Seleccionar tipo archivo (Excel/PDF) | Excel OK | PDF NO EXISTE |
| Seleccionar Entidad Bancaria | `bankAccountId` | OK |
| Parsers especificos por entidad | 3 formatos | PARCIAL - falta mas bancos |

**Estado**: PARCIAL - Solo soportamos Excel, 3 formatos

### 3.4.2 Categorizacion Obligatoria

| Campo Documento | Campo Actual | Estado |
|-----------------|--------------|--------|
| Mostrar movimientos sin categoria | `categoryId = null` | OK |
| Bloquear uso hasta 100% categorizado | NO EXISTE | CRITICO - FALTA |
| Vincular a Categoria de EE.RR. | `categoryId` FK | OK |

**Lo que falta**:
- Validacion que impida cerrar/usar datos sin 100% categorizado
- Indicador visual de % de categorizacion

### 3.4.3 Reemplazo/Desglose de Pagos Netos

| Campo Documento | Campo Actual | Estado |
|-----------------|--------------|--------|
| Reemplazar pago neto por movimientos brutos | NO EXISTE | CRITICO - FALTA |
| Balance Cero Obligatorio | NO EXISTE | FALTA |
| Estado Stand By para operaciones pendientes | NO EXISTE | FALTA |
| Alerta de Pendientes | NO EXISTE | FALTA |

**Ejemplo del documento**:
- Pago neto de MP: $10,000
- Desglose: Venta Bruta $12,000 - Comision $1,500 - Impuestos $500 = $10,000

**Impacto**: ALTO - Funcionalidad clave para conciliacion real

---

# SECCION 4: FASE 3 - OPERACION DIARIA Y REPORTES

## 4.1 Sistema de Ventas (POS)

| Campo Documento | Campo Actual | Estado |
|-----------------|--------------|--------|
| Interfaz tactil (Mesas, Comandas) | NO EXISTE | CRITICO - FALTA |
| Multiples formas de pago | NO EXISTE | FALTA |
| Link AFIP Factura Electronica | NO EXISTE | CRITICO - FALTA |
| Al facturar: descontar consumo teorico de insumos | NO EXISTE | FALTA |
| Registrar CMV de cada ticket | NO EXISTE | FALTA |

**Tablas que necesitariamos crear**:
```
tables (mesas): id, localId, name, capacity, status
orders (comandas): id, localId, tableId, status, openedAt, closedAt
orderItems: id, orderId, recipeId, quantity, unitPrice, notes
tickets: id, orderId, ticketNumber, afipCAE, afipDate, total, paymentMethod
```

**Impacto**: CRITICO - Modulo completamente nuevo

## 4.2 Historial de Cierres de Caja

| Campo Documento | Campo Actual | Estado |
|-----------------|--------------|--------|
| Registro inmutable de cierres/arqueos | NO EXISTE | FALTA |
| Por Cajero | NO EXISTE | FALTA |
| Diferencias de efectivo | NO EXISTE | FALTA |
| Desglose por medio de pago | NO EXISTE | FALTA |

**Tabla que necesitariamos**:
```
cashClosings: id, localId, userId, shift, expectedCash, actualCash, difference, 
              cardTotal, mpTotal, otherTotal, closedAt, notes
```

---

## 4.3 Saldos (Vista Consolidada)

| Campo Documento | Campo Actual | Estado |
|-----------------|--------------|--------|
| Seleccionar Local y Año | PARCIAL | Filtros existen |
| Alimentado por Extractos (Ingresos/Egresos) | OK | `transactions` |
| Movimientos especiales (Inicio Mes, Retiro) | NO EXISTE | FALTA |

---

## 4.4 Estados de Resultados (EE.RR.)

| Campo Documento | Campo Actual | Estado |
|-----------------|--------------|--------|
| Seleccionar Local y Año | OK | Filtros en balance |
| Consolidacion: Categoria → Grupo → Reporte | PARCIAL | Existe agrupacion basica |
| Estructura formal EE.RR. | NO EXISTE | FALTA |
| Exportacion PDF/Excel | NO EXISTE | FALTA |

**Lo que falta**:
- Formato formal de EE.RR. (Ingresos - Gastos = Resultado)
- Subtotales por grupo
- Comparativo mensual
- Exportacion profesional

---

## 4.5 Punto de Equilibrio

| Campo Documento | Campo Actual | Estado |
|-----------------|--------------|--------|
| Definir Costos Fijos (seleccionar categorias) | NO EXISTE | FALTA |
| Calcular % facturado del costo fijo | NO EXISTE | FALTA |
| Elegir producto y calcular P.E. con margen | NO EXISTE | FALTA |

**Modulo completamente por desarrollar**

---

# SECCION 5: FASE 4 - MODULOS FUTUROS (ARQUITECTURA)

## 5.1 Comparacion de Listas de Precios

| Requisito | Estado |
|-----------|--------|
| Multiples precios por insumo, por proveedor, por fecha | NO EXISTE |
| Tabla `supplierPrices` necesaria | FALTA |

## 5.2 Analisis Insumos mas Utilizados

| Requisito | Estado |
|-----------|--------|
| Consumo desde Recetas vs Facturas | PARCIAL - datos existen |
| % de Costo Total | NO CALCULADO |

## 5.3 Recursos Humanos - Costo Laboral

| Requisito | Estado |
|-----------|--------|
| Vincular Costo Laboral a Ventas | NO EXISTE |
| Costo por hora/dia | PARCIAL - tenemos `baseSalary` |

## 5.4 Logs de Cambios (Auditoria)

| Requisito | Estado |
|-----------|--------|
| Tabla de Logs para acciones CUD | EXISTE | `auditLog` |
| Modulos sensibles (Facturacion, Inventario) | PARCIAL - estructura existe, no implementado |

**Tabla Actual**: `auditLog` (id, clientId, userId, action, tableName, recordId, oldData, newData, createdAt)

**Estado**: Estructura existe, falta implementacion en todos los endpoints

## 5.5 Desvio de Mercaderia

| Requisito | Estado |
|-----------|--------|
| Consumo Teorico vs Real | PARCIAL | Tenemos `stockLevels.theoreticalStock` y `actualStock` |
| Calculo automatico de desvio | NO IMPLEMENTADO |

---

# SECCION 6: REQUISITOS TRANSVERSALES

## 6.1 Alarmas Prioritarias

| Requisito | Estado |
|-----------|--------|
| Notificaciones por Email | NO EXISTE |
| Notificaciones App celular | NO EXISTE |
| Solo a usuarios "SOCIOS" | PARCIAL - rol existe |
| Actualizacion de Costos | NO EXISTE |
| Facturas Vencidas | NO EXISTE |
| Facturas Faltantes (AFIP) | NO EXISTE |

**Tabla Actual**: `notifications` (in-app solamente, no email/push)

---

# RESUMEN EJECUTIVO

## Estado por Modulo

| Modulo | % Completitud | Prioridad |
|--------|---------------|-----------|
| 1. Unidades de Medida | 100% | - |
| 2. Rubros de Insumos | 100% | - |
| 3. Impuestos | 70% | Media (falta catalogo maestro) |
| 4. Proveedores | 80% | Media (falta condicion IVA, nombre comercial) |
| 5. Insumos | 100% | - |
| 6. Locales | 60% | Alta (falta razon social, PV AFIP) |
| 7. Grupos/Categorias EE.RR. | 80% | Media (falta movimientos especiales) |
| 8. Saldos/Entidades | 100% | - |
| 9. Carga Facturas | 50% | CRITICA (falta CPP real, reversiones, alertas) |
| 10. Pagos/Ctas Corrientes | 70% | Alta (falta graficos, vista vencidos) |
| 11. Categorias Platos | 100% | - |
| 12. Sub-Recetas | 40% | Alta (falta diferenciacion, peso util) |
| 13. Platos/Fichas Tecnicas | 60% | Alta (falta sub-recetas como ingrediente, impresion) |
| 14. Historial Costos | 50% | Media (falta graficos, top 10) |
| 15. Extractos Bancarios | 60% | Alta (falta bloqueo, desglose) |
| 16. EE.RR. | 40% | CRITICA (falta formato formal, exportacion) |
| 17. POS/Ventas | 0% | CRITICA (modulo nuevo) |
| 18. Cierres Caja | 0% | Alta (modulo nuevo) |
| 19. Punto Equilibrio | 0% | Media (modulo nuevo) |
| 20. Autenticacion Dual | 0% | CRITICA (requiere decision arquitectonica) |
| 21. Permisos Granulares | 40% | Alta (estructura existe, falta UI completa) |
| 22. Alarmas Email/Push | 0% | Alta (modulo nuevo) |
| 23. Auditoria Logs | 20% | Media (tabla existe, falta implementacion) |

## Promedio Ponderado de Completitud: ~45%

## Modulos Criticos Faltantes (Bloquean Operacion Real):
1. **POS/Sistema de Ventas** - 0%
2. **Autenticacion Dual** - 0%
3. **Reversiones Completas en Facturas** - 0%
4. **EE.RR. Formal con Exportacion** - 40%
5. **Alertas a Socios** - 0%

---

# DECISIONES ARQUITECTONICAS PENDIENTES

1. **Autenticacion**: Mantener Replit Auth + agregar auth propia, o reemplazar completamente?
2. **Base de Datos**: Supabase para produccion - como manejar migracion?
3. **POS**: Desarrollo propio o integracion con sistema externo?
4. **AFIP**: API propia o usar servicio intermediario (ej: Afip.js)?
5. **Notificaciones**: Email via que servicio? (SendGrid, Resend, etc.)

---

Documento generado para revision conjunta.
Fecha: Diciembre 2024
