# Data Flow 5.0 - Plataforma de Gestion Empresarial para Gastronomia

## Preferencias del Usuario
- **IMPORTANTE**: Siempre pedir confirmacion expresa antes de comenzar a trabajar en cualquier modulo o funcionalidad, sin importar cuantas tareas haya pendientes
- Idioma de comunicacion: Español
- **CRITICO - PRUEBAS**: Las pruebas se hacen desde la VISTA PREVIA del panel derecho del editor, NO desde URLs publicadas (.replit.app)

## ARQUITECTURA DE PROYECTOS (NO CONFUNDIR)

### Proyecto Actual: DataFlowAnalyze (DESARROLLO)
- **Proposito**: Desarrollo, pruebas, mejoras
- **Base de datos**: Replit Postgres (Neon) - postgresql://...ep-frosty-sea-ah66w5pp...neondb
- **URL publicacion**: https://DATAFLOW2.replit.app
- **Secret activo**: DATABASE_URL (Replit Postgres)
- **REGLA**: Este proyecto SOLO usa Replit Postgres. NUNCA tocar ni mencionar Supabase aqui.

### Proyecto Separado: DataFlow-Produccion (PRODUCCION)
- **Proposito**: Versiones estables para socios y clientes
- **Base de datos**: Supabase
- **Manejo**: Completamente separado, NO se toca desde este chat

### Reglas Criticas
1. NUNCA confundir las bases de datos entre proyectos
2. El secret SUPABASE_DATABASE_URL existe pero NO se usa en este proyecto
3. Todas las pruebas de desarrollo se hacen en la vista previa, no en URLs publicadas
4. Cuando se confirma una version funcional, se migra manualmente al proyecto de produccion

## Descripcion General
Data Flow 5.0 es una plataforma multi-tenant de gestion empresarial diseñada para negocios de gastronomia (restaurantes, cafeterias, franquicias). Migra funcionalidad de Google Sheets a una aplicacion web profesional.

## Decisiones Arquitectonicas (Diciembre 2024)

### Autenticacion
- **Decision**: Auth propia completa (Opcion B)
- **Razon**: Preparar para migracion a Supabase Auth en produccion
- **Implementacion**: Email + Password con hash, Username + Password para operativos (cajeros, mozos)
- **Estado**: PENDIENTE - Replit Auth sera reemplazado

### POS (Punto de Venta)
- **Decision**: Desarrollo propio completo
- **Razon**: Control total, integracion nativa con recetas/stock/costos
- **Incluye**: Mesas, comandas, tickets, cierres de caja, multi-medio de pago

### Integracion AFIP
- **Decision**: Servicio intermediario (Afip.js o similar)
- **Razon**: Simplicidad - evitar complejidad de certificados y homologacion directa

### Notificaciones Email
- **Decision**: Resend (tier gratuito 3,000/mes) o Supabase Auth integrado
- **Prioridad**: Servicios gratuitos/incluidos

### Base de Datos
- **Este proyecto**: Replit Postgres (Neon) via @neondatabase/serverless
- **Secret**: DATABASE_URL
- **ORM**: Drizzle ORM
- **NOTA**: El secret SUPABASE_DATABASE_URL existe pero se IGNORA completamente en este proyecto

## Estado Actual del Proyecto: ~65% Completitud

Ver archivo `ANALISIS_EXHAUSTIVO_DATA_FLOW.md` para detalle campo por campo.

### Modulos Completos (100%)
- Unidades de Medida
- Rubros de Insumos
- **Sub-Rubros** - NUEVO: tabla separada con FK a rubros, CRUD completo con validacion Zod y aislamiento multi-tenant
- Insumos (estructura basica + filtros por sub-rubro/estado + columna fecha ultima compra + asignacion de sub-rubro)
- Categorias de Platos
- Saldos/Entidades Bancarias

### Modulos Parciales (40-95%)
- Proveedores (90%) - Mejorado: filtros por condicion IVA y estado activo, multi-rubros via tabla supplier_rubros con dialog de checkboxes
- Locales (75%) - Mejorado: campos responsable (nombre, telefono, email)
- Impuestos (70%) - Falta: catalogo maestro precargado
- **Facturas (95%)** - COMPLETADO: CPP promedio ponderado con agregacion, reversiones con pre-validacion, alertas variacion costo, tabla comparativa, movimientos stock automaticos
- **Pagos/Ctas Ctes (90%)** - COMPLETADO: grafico deuda top-10 (pie chart), vista facturas vencidas con tabs
- Recetas (60%) - Falta: sub-recetas como ingrediente, impresion
- **Extractos (90%)** - COMPLETADO: Importacion Excel, categorizacion, % progreso, desglose por categoria con totales
- EE.RR. (40%) - Falta: formato formal, exportacion
- Permisos (40%) - Falta: UI completa, perfiles

### Modulos No Iniciados (0%)
- POS/Sistema de Ventas
- Autenticacion Dual (Email + Username/Password)
- Cierres de Caja
- Punto de Equilibrio
- Alertas Email/Push
- Integracion AFIP

## Arquitectura Tecnica

### Stack
- **Frontend**: React + Vite + TailwindCSS + shadcn/ui
- **Backend**: Express.js + TypeScript
- **Base de datos**: PostgreSQL + Drizzle ORM
- **Autenticacion**: (En transicion) Replit Auth → Auth Propia/Supabase

### Estructura de Archivos Principales
```
├── client/
│   ├── src/
│   │   ├── pages/           # Paginas de la aplicacion
│   │   ├── components/      # Componentes reutilizables
│   │   │   ├── ui/          # shadcn components
│   │   │   ├── app-sidebar.tsx
│   │   │   ├── data-table.tsx
│   │   │   ├── page-header.tsx
│   │   │   └── confirm-dialog.tsx
│   │   ├── hooks/           # Custom hooks
│   │   └── lib/             # Utilidades (formatters, queryClient)
├── server/
│   ├── routes.ts            # API endpoints
│   ├── storage.ts           # Capa de acceso a datos
│   ├── db.ts                # Conexion a PostgreSQL
│   └── replitAuth.ts        # (A reemplazar) Configuracion OIDC
└── shared/
    └── schema.ts            # Modelos Drizzle + tipos TypeScript
```

### Aislamiento Multi-Tenant
**CRITICO**: Toda la aplicacion usa aislamiento por `client_id`
- Cada usuario pertenece a un cliente (tabla `user_clients`)
- Todas las tablas de datos tienen `client_id` como FK
- **Los endpoints de mutacion (PATCH/DELETE) DEBEN validar client_id**
- La funcion `getClientId(req)` extrae el clientId del usuario autenticado

### Seguridad Implementada
- Todas las operaciones de storage validan `client_id` con condicion AND
- Los endpoints devuelven 404 si el recurso no pertenece al tenant
- No es posible modificar/eliminar datos de otro tenant
- Validacion de duplicados: CUIT unico por proveedor, numero de factura unico por proveedor

## Documentos de Referencia
- `ANALISIS_EXHAUSTIVO_DATA_FLOW.md` - Comparacion campo por campo vs requisitos
- `PLAN_DE_ACCION_DATA_FLOW.md` - Backlog priorizado por fases
- `attached_assets/Data_Flow_5.0_*.pdf` - Documento original de requisitos

## Catalogos del Sistema
1. **Proveedores** - Datos fiscales, CUIT, dias de pago
2. **Insumos** - Productos/materiales con costo unitario
3. **Rubros** - Categorias para insumos
4. **Locales** - Sucursales/ubicaciones del negocio
5. **Impuestos** - IVA, percepciones, etc.
6. **Unidades de Medida** - kg, lt, unidad, etc.

## Preferencias de Diseño
- Tipografia: Inter para UI, JetBrains Mono para datos numericos
- Tema: Soporte dark/light mode
- Componentes: Uso exclusivo de shadcn/ui
- Todos los elementos interactivos tienen `data-testid`

## Endpoints API Principales

### Catalogos
- `GET/POST /api/suppliers` - Proveedores
- `GET/POST /api/supplies` - Insumos
- `GET/POST /api/rubros` - Rubros
- `GET/POST /api/locals` - Locales
- `GET/POST /api/taxes` - Impuestos
- `GET/POST /api/units` - Unidades

### Facturacion
- `GET/POST /api/invoices` - Facturas
- `GET /api/invoices/:id` - Detalle con items y taxes
- `GET/POST /api/payments` - Pagos
- `GET /api/supplier-accounts` - Cuentas corrientes

### Recetas
- `GET/POST /api/recipes` - Recetas
- `GET /api/recipes/:id` - Detalle con ingredientes
- `GET/POST /api/recipe-categories` - Categorias

### Financiero
- `GET /api/transaction-categories` - Categorias de movimientos
- `GET /api/bank-accounts` - Cuentas bancarias
- `GET /api/transactions` - Transacciones
- `GET /api/monthly-balances` - Balances mensuales
- `GET /api/dashboard/stats` - Estadisticas dashboard

## Backup y Control de Versiones (GitHub)

### Repositorio Vinculado
- **URL**: https://github.com/dataflowbackup/dataflow
- **Remote configurado**: `github` (con token de autenticacion)
- **Rama principal**: `main`

### Como hacer backup a GitHub
Ejecutar en la Shell de Replit:
```bash
git push github HEAD:main
```
No pide credenciales porque el token esta configurado en la URL del remote.

### Sistemas de Backup Activos
1. **Replit Checkpoints**: Automatico, permite restaurar versiones anteriores desde Replit
2. **GitHub**: Manual, ejecutar el comando push periodicamente (recomendado al final de cada sesion)

### Cuando hacer push a GitHub
- Al finalizar una sesion de trabajo
- Despues de completar una funcionalidad importante
- Antes de hacer cambios grandes o experimentales
- Como minimo una vez por dia de trabajo

### Archivos en server/github.ts
Contiene la integracion con la API de GitHub via Octokit para operaciones programaticas si se necesitan en el futuro.

## Comandos de Desarrollo
```bash
npm run dev          # Inicia servidor de desarrollo
npm run db:push      # Sincroniza schema con BD
npm run db:generate  # Genera migraciones
```

## Notas de Implementacion
- El año fiscal es configurable (no siempre enero-diciembre)
- Los balances mensuales deben mantener correlatividad
- El dashboard necesita 10 widgets con exportacion PDF/Excel
- Sistema de categorias soporta 200+ categorias personalizables
