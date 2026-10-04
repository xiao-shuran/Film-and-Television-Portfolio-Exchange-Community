param([int]$Port = 4173)
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$node = (Get-Command node -ErrorAction Stop).Source
& $node (Join-Path $root 'start-local.mjs') $Port
if ($LASTEXITCODE -ne 0) { throw 'Server startup failed. Check data\server-error.log.' }
