param([switch]$Foreground)
$ErrorActionPreference = "Stop"
$arguments = @((Join-Path $PSScriptRoot "packages/desktop/scripts/launch-desktop.mjs"))
if ($Foreground) { $arguments += "--foreground" }
& node @arguments
exit $LASTEXITCODE
