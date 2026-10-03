param([int]$Port = 4173)
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$node = (Get-Command node -ErrorAction Stop).Source
$listener = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
if ($listener) { throw "Port $Port is already in use. Choose another -Port." }
& $node (Join-Path $root 'start-local.mjs') $Port
if ($LASTEXITCODE -ne 0) { throw 'Server startup failed. Check data\server-error.log.' }
