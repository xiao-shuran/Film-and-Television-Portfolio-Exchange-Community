$ErrorActionPreference = 'Stop'

$site = (Resolve-Path -LiteralPath $PSScriptRoot).Path
$parent = (Resolve-Path -LiteralPath (Join-Path $site '..')).Path
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$staging = Join-Path $parent ('.after-the-credits-package-' + [guid]::NewGuid().ToString('N'))
$destination = Join-Path $staging 'film-blog'
$archive = Join-Path $parent ("after-the-credits-source-$stamp.zip")

function Assert-ChildPath([string] $Path, [string] $Root) {
  $full = [System.IO.Path]::GetFullPath($Path)
  $rootFull = [System.IO.Path]::GetFullPath($Root).TrimEnd('\') + '\'
  if (-not $full.StartsWith($rootFull, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "拒绝使用工作目录之外的路径: $full"
  }
}

function Get-Sha256([string] $Path) {
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    $stream = [System.IO.File]::OpenRead($Path)
    try {
      return (($sha.ComputeHash($stream) | ForEach-Object { $_.ToString('x2') }) -join '').ToUpperInvariant()
    } finally {
      $stream.Dispose()
    }
  } finally {
    $sha.Dispose()
  }
}

Assert-ChildPath $staging $parent
Assert-ChildPath $archive $parent
New-Item -ItemType Directory -Path $destination -Force | Out-Null
try {
  Get-ChildItem -LiteralPath $site -Force |
    Where-Object {
      $_.Name -notin @('data', 'uploads', '.env', 'node_modules') -and
      $_.Name -notmatch '\.(sqlite|sqlite-wal|sqlite-shm|log)$'
    } |
    ForEach-Object {
      Copy-Item -LiteralPath $_.FullName -Destination $destination -Recurse
    }
  Compress-Archive -LiteralPath $destination -DestinationPath $archive -CompressionLevel Optimal -Force
  $hash = Get-Sha256 $archive
  Write-Host "源码包已生成: $archive"
  Write-Host "SHA-256: $hash"
  Write-Host '已排除 data、uploads、.env、node_modules 和运行数据库。'
} finally {
  if (Test-Path -LiteralPath $staging) {
    Remove-Item -LiteralPath $staging -Recurse -Force
  }
}
