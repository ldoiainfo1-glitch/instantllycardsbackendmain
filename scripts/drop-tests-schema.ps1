$ErrorActionPreference = 'Stop'
$orig = (Get-Content .env | Where-Object { $_ -match '^DATABASE_URL=' } | ForEach-Object { $_.Split('=',2)[1] })
if (-not $orig) { throw 'DATABASE_URL not found in .env' }

$env:DATABASE_URL = $orig

Write-Host "Dropping tests schema..."
cmd /c "echo DROP SCHEMA IF EXISTS tests CASCADE; | npx prisma db execute --stdin"
