import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChevronLeft, ChevronRight, Search, Plus, Filter } from "lucide-react";
import { useState, useMemo, useEffect } from "react";

export interface Column<T> {
  key: string;
  header: string;
  cell?: (row: T) => React.ReactNode;
  className?: string;
}

export interface FilterOption {
  value: string;
  label: string;
}

export interface FilterConfig<T> {
  key: keyof T;
  label: string;
  options: FilterOption[];
  allLabel?: string;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  isLoading?: boolean;
  searchPlaceholder?: string;
  searchKeys?: (keyof T)[];
  /** Si es false, no se muestra la barra de busqueda (el padre filtra `data`). */
  showSearch?: boolean;
  filters?: FilterConfig<T>[];
  onAdd?: () => void;
  addLabel?: string;
  emptyMessage?: string;
  pageSize?: number;
}

export function DataTable<T extends { id: number | string }>({
  columns,
  data,
  isLoading = false,
  searchPlaceholder = "Buscar...",
  searchKeys = [],
  showSearch = true,
  filters = [],
  onAdd,
  addLabel = "Agregar",
  emptyMessage = "No hay datos para mostrar",
  pageSize = 10,
}: DataTableProps<T>) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [activeFilters, setActiveFilters] = useState<Record<string, string>>({});

  const filteredData = useMemo(() => {
    let result = data;
    
    if (search && searchKeys.length > 0) {
      const lowerSearch = search.toLowerCase();
      result = result.filter((row) =>
        searchKeys.some((key) => {
          const value = row[key];
          if (typeof value === "string") {
            return value.toLowerCase().includes(lowerSearch);
          }
          if (typeof value === "number") {
            return value.toString().includes(lowerSearch);
          }
          return false;
        })
      );
    }
    
    for (const filter of filters) {
      const filterValue = activeFilters[filter.key as string];
      if (filterValue && filterValue !== "__all__") {
        result = result.filter((row) => {
          const rowValue = row[filter.key];
          if (rowValue === null || rowValue === undefined) {
            return filterValue === "__empty__";
          }
          return String(rowValue) === filterValue;
        });
      }
    }
    
    return result;
  }, [data, search, searchKeys, filters, activeFilters]);

  // Si `data` o filtros reducen los resultados y la pagina actual queda fuera de rango, la tabla quedaba vacia.
  useEffect(() => {
    const total = filteredData.length;
    const tp = Math.ceil(total / pageSize) || 1;
    const maxPage = Math.max(0, tp - 1);
    if (page > maxPage) setPage(maxPage);
  }, [filteredData.length, pageSize, page]);

  const paginatedData = useMemo(() => {
    const start = page * pageSize;
    return filteredData.slice(start, start + pageSize);
  }, [filteredData, page, pageSize]);

  const totalPages = Math.ceil(filteredData.length / pageSize);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          {showSearch && <Skeleton className="h-10 w-72" />}
          <Skeleton className="h-10 w-32" />
        </div>
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                {columns.map((col) => (
                  <TableHead key={col.key}>
                    <Skeleton className="h-4 w-20" />
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  {columns.map((col) => (
                    <TableCell key={col.key}>
                      <Skeleton className="h-4 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          {showSearch && (
            <div className="relative w-full sm:w-72">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder={searchPlaceholder}
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(0);
                }}
                className="pl-9"
                data-testid="input-search"
              />
            </div>
          )}
          {onAdd && (
            <Button onClick={onAdd} data-testid="button-add">
              <Plus className="h-4 w-4 mr-2" />
              {addLabel}
            </Button>
          )}
        </div>
        {filters.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            {filters.map((filter) => (
              <Select
                key={filter.key as string}
                value={activeFilters[filter.key as string] || "__all__"}
                onValueChange={(value) => {
                  setActiveFilters((prev) => ({ ...prev, [filter.key]: value }));
                  setPage(0);
                }}
              >
                <SelectTrigger className="w-[160px] h-9" data-testid={`filter-${filter.key as string}`}>
                  <SelectValue placeholder={filter.label} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">{filter.allLabel || `Todos`}</SelectItem>
                  {filter.options.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((col) => (
                <TableHead key={col.key} className={col.className}>
                  {col.header}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {paginatedData.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-24 text-center text-muted-foreground"
                >
                  {emptyMessage}
                </TableCell>
              </TableRow>
            ) : (
              paginatedData.map((row) => (
                <TableRow key={row.id} data-testid={`row-${row.id}`}>
                  {columns.map((col) => (
                    <TableCell key={col.key} className={col.className}>
                      {col.cell ? col.cell(row) : String((row as any)[col.key] ?? "")}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Mostrando {page * pageSize + 1}-{Math.min((page + 1) * pageSize, filteredData.length)} de{" "}
            {filteredData.length} resultados
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              data-testid="button-prev-page"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm">
              Pagina {page + 1} de {totalPages}
            </span>
            <Button
              variant="outline"
              size="icon"
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              data-testid="button-next-page"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
