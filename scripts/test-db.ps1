$ErrorActionPreference = 'Stop'
$orig = (Get-Content .env | Where-Object { $_ -match '^DATABASE_URL=' } | ForEach-Object { $_.Split('=',2)[1] })
if (-not $orig) { throw 'DATABASE_URL not found in .env' }

$testUrl = "${orig}?schema=tests"
$env:DATABASE_URL = $testUrl
$env:TEST_DATABASE_URL = $testUrl
$env:NODE_ENV = 'test'

Write-Host "Using TEST_DATABASE_URL=$testUrl"

# Ensure tests schema exists
cmd /c "echo CREATE SCHEMA IF NOT EXISTS tests; | npx prisma db execute --stdin"

# Apply migrations to tests schema
cmd /c npx prisma migrate deploy

# Run tests
cmd /c npm test
