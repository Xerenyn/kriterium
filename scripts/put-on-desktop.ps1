$ErrorActionPreference = 'Stop'

$project = Split-Path -Parent $PSScriptRoot
$release = Join-Path $project 'release\Kriterium-1.0.0.exe'
$desktop = [Environment]::GetFolderPath('Desktop')
$destination = Join-Path $desktop 'Kriterium-1.0.0.exe'

if (-not (Test-Path -LiteralPath $release)) {
  throw "Portable build not found: $release"
}

# Remove only the shortcut created earlier by this project, not other shortcuts.
$wsh = New-Object -ComObject WScript.Shell
Get-ChildItem -LiteralPath $desktop -Filter '*.lnk' -ErrorAction SilentlyContinue | ForEach-Object {
  $shortcut = $wsh.CreateShortcut($_.FullName)
  if ($shortcut.TargetPath -like '*\release\win-unpacked\*') {
    Remove-Item -LiteralPath $_.FullName
  }
}

Copy-Item -LiteralPath $release -Destination $destination -Force
Write-Output "Copied app to: $destination"
Write-Output "Size: $((Get-Item -LiteralPath $destination).Length) bytes"
