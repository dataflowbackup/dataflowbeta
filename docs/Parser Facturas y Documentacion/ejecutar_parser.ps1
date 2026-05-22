# Genera facturas_dataflow.xlsx desde los PDF en facturas_entrada/
# Requiere ANTHROPIC_API_KEY en .env o .env.local (raíz del repo Dataflow).
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$outDir = Join-Path $PSScriptRoot "salida_parser"
if (-not (Test-Path $outDir)) {
  New-Item -ItemType Directory -Path $outDir | Out-Null
}

$output = Join-Path $outDir "facturas_dataflow.xlsx"

Write-Host "Salida: $output"
Write-Host "Tip: prueba corta — max 3 paginas:"
Write-Host '  python factura_parser.py --input .\facturas_entrada --output .\salida_parser\facturas_dataflow.xlsx --max-jobs 3'

python factura_parser.py --input .\facturas_entrada --output $output --delay 1.0
