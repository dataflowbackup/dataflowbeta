# Data Flow 2.0 - Design Guidelines

## Design Approach

**System-Based Approach**: Material Design principles adapted for enterprise financial management, emphasizing clarity, data density, and operational efficiency. This application prioritizes information hierarchy, scannable layouts, and form usability over visual flair.

## Typography System

**Font Families:**
- Primary: Inter (headers, UI elements, data)
- Monospace: JetBrains Mono (numerical data, codes, CUITs)

**Type Scale:**
- Page Headers: text-3xl font-bold (forms, modules)
- Section Headers: text-xl font-semibold
- Subsection Headers: text-lg font-medium
- Body Text: text-base
- Secondary/Meta: text-sm
- Captions/Labels: text-xs font-medium uppercase tracking-wide
- Numerical Data: text-base font-mono (amounts, percentages)
- Large Numbers (Dashboard): text-4xl font-bold font-mono

## Layout System

**Spacing Primitives**: Use Tailwind units of 2, 4, 6, 8, 12, 16 consistently
- Component padding: p-4 to p-6
- Section spacing: py-8 to py-12
- Card padding: p-6
- Form field spacing: space-y-4
- Grid gaps: gap-4 to gap-6

**Container Strategy:**
- Full-width app with sidebar navigation: max-w-full
- Content areas: max-w-7xl mx-auto px-6
- Forms: max-w-4xl
- Modal dialogs: max-w-2xl

**Grid Layouts:**
- Dashboard cards: grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6
- Form fields: Two-column on desktop (grid-cols-2), single on mobile
- Data tables: Full-width with horizontal scroll on mobile

## Core Components

### Navigation
**Sidebar Navigation** (persistent, left-aligned):
- Fixed left sidebar (w-64) with collapsible state
- Logo at top (h-16)
- Primary navigation items with icons (h-10 each, hover state)
- User profile/settings at bottom
- Active state: subtle left border accent
- Nested menus: indented pl-8

**Top Bar** (when sidebar present):
- Breadcrumbs (text-sm)
- Page title (text-2xl font-bold)
- Action buttons aligned right
- Height: h-16, shadow-sm

### Forms
**Input Fields:**
- Labels: text-sm font-medium mb-1, required indicator with asterisk
- Text inputs: h-10, rounded-md, border, px-3
- Select dropdowns: Same height as inputs, chevron icon
- Textarea: min-h-24
- Number inputs: font-mono, right-aligned text
- Date pickers: calendar icon, formatted display
- Checkbox/Radio: Custom styled, larger touch targets (h-5 w-5)

**Form Layout:**
- Two-column grid on desktop (lg:grid-cols-2 gap-6)
- Related fields grouped with subtle background/border
- Form sections separated with dividers and subsection headers
- Sticky action buttons at bottom: "Guardar", "Cancelar"

**Complex Forms (Invoices):**
- Multi-step if needed, progress indicator at top
- Expandable sections for detailed items
- Dynamic field addition (+ Agregar Insumo button)
- Inline calculations display (subtotals, totals) with font-mono
- Summary panel (sticky right on desktop, bottom on mobile)

### Data Tables
**Structure:**
- Striped rows (subtle alternation)
- Fixed header on scroll
- Column headers: text-xs font-semibold uppercase tracking-wide, sortable indicators
- Cell padding: px-4 py-3
- Row height: h-12
- Actions column: right-aligned, icon buttons
- Pagination: Bottom center, showing "X-Y de Z resultados"
- Filters: Top of table, collapsible panel

**Financial Tables:**
- Amount columns: right-aligned, font-mono
- Date columns: consistent format
- Status badges: inline pills with icon
- Expandable rows for details (chevron indicator)

### Cards & Panels
**Dashboard Cards:**
- Rounded corners (rounded-lg)
- Shadow: shadow-sm with hover:shadow-md transition
- Padding: p-6
- Header with icon + title (text-lg font-semibold)
- Large metric: text-4xl font-bold font-mono
- Secondary info: text-sm below metric
- Trend indicator: small arrow icon + percentage

**Summary Panels:**
- Sticky positioning where applicable
- Background differentiation from main content
- Key-value pairs: label in text-sm, value in text-base font-medium

### Charts & Visualizations
**Chart Components:**
- Consistent height: h-64 for dashboard cards, h-96 for full-width
- Use Recharts library
- Bar charts: For top 10 comparisons
- Pie charts: For composition breakdowns, with legend
- Line charts: For temporal data
- Tooltips: Show on hover with precise values
- Axis labels: text-xs
- Legend: Below chart or right-aligned

### Buttons & Actions
**Primary Actions:**
- Height: h-10
- Padding: px-4
- Rounded: rounded-md
- Font: text-sm font-medium
- Icons: 16x16, positioned left or right

**Button Hierarchy:**
- Primary CTA: Solid fill
- Secondary: Outlined
- Tertiary/Ghost: Text only
- Destructive: Distinct treatment for delete/remove
- Icon-only: h-10 w-10, center icon

**Action Groups:**
- Space-x-2 between buttons
- Right-aligned in forms/modals
- Sticky at bottom for long forms

### Modals & Overlays
**Modal Dialogs:**
- Max-width: max-w-2xl (standard), max-w-4xl (complex forms)
- Backdrop: Darkened overlay
- Padding: p-6
- Header: text-xl font-semibold, close button (×)
- Content: Natural scrolling if needed
- Footer: Actions right-aligned

**Toast Notifications:**
- Top-right positioning
- Auto-dismiss after 5s
- Types: Success, Error, Warning, Info
- Icon + message + close button

### Dashboard Specific

**KPI Grid** (4 columns desktop):
- Card per metric
- Icon, label, large number, trend

**Top 10 Lists:**
- Numbered list (1-10)
- Item name, bar visualization, value
- Responsive: Stack on mobile

**Export Actions:**
- Dropdown menu: "Exportar como PDF" / "Exportar como Excel" / "Enviar por Email"
- Icon: download or email

## Responsive Strategy

**Breakpoints:**
- Mobile: < 768px (single column, hamburger menu)
- Tablet: 768px - 1024px (sidebar collapse option, 2-column grids)
- Desktop: > 1024px (full sidebar, multi-column layouts)

**Mobile Adaptations:**
- Sidebar becomes slide-out drawer
- Tables: Horizontal scroll or card-based view
- Forms: Single column
- Dashboard: Stack all cards
- Charts: Reduce height, simplify labels

## Key UI Patterns

**Master-Detail Views:**
- List on left (or top on mobile), detail panel on right
- Selected item highlighted
- Detail panel with all actions

**Bulk Actions:**
- Checkbox selection in tables
- Action bar appears at top when items selected
- Clear selection indicator

**Search & Filters:**
- Global search: Top bar
- List filtering: Above tables, collapsible
- Advanced filters: Modal or expandable panel

**Validation & Errors:**
- Inline validation on blur
- Error messages: text-sm below field, with icon
- Success states: Subtle checkmark
- Required fields: Clear visual indicator

## Accessibility & Interactions

- All interactive elements: min-height 44px touch target
- Focus states: Visible outline on keyboard navigation
- Form labels: Properly associated with inputs
- Error states: Announced to screen readers
- Loading states: Skeleton loaders for data tables, spinner for actions
- Empty states: Helpful message + illustration/icon + CTA

## Images

**Minimal Image Usage:**
This is a data-driven application. Images used sparingly:
- Logo: Company branding in sidebar (h-8)
- Empty states: Simple illustrations or icons (h-32)
- User avatars: Small circles (h-8 w-8) in navigation
- No hero images - application is form/data focused from entry