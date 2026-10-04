$ErrorActionPreference = 'Stop'

$site = (Resolve-Path -LiteralPath $PSScriptRoot).Path
$parent = (Resolve-Path -LiteralPath (Join-Path $site '..')).Path
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$staging = Join-Path $parent ('.after-the-credits-backup-' + [guid]::NewGuid().ToString('N'))
$destination = Join-Path $staging 'film-blog'
$archive = Join-Path $parent ("after-the-credits-full-backup-$stamp.zip")

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
Write-Warning '完整备份包含数据库、上传作品、论坛内容、管理员哈希和 .env 配置。请先停止网站，并把压缩包放在私密位置。'
New-Item -ItemType Directory -Path $destination -Force | Out-Null
try {
  Get-ChildItem -LiteralPath $site -Force |
    Where-Object {
      $_.Name -ne 'node_modules' -and
      $_.Name -notmatch '\.(zip|log)$'
    } |
    ForEach-Object {
      Copy-Item -LiteralPath $_.FullName -Destination $destination -Recurse
    }
  Compress-Archive -LiteralPath $destination -DestinationPath $archive -CompressionLevel Optimal -Force
  $hash = Get-Sha256 $archive
  Write-Host "完整备份已生成: $archive"
  Write-Host "SHA-256: $hash"
} finally {
  if (Test-Path -LiteralPath $staging) {
    Remove-Item -LiteralPath $staging -Recurse -Force
  }
}
