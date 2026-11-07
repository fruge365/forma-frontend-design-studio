param([ValidateRange(1024, 65535)][int]$Port = 4173)
$ErrorActionPreference = 'Stop'
$nodePath = (Get-Command node -ErrorAction Stop).Source
& $nodePath (Join-Path $PSScriptRoot 'serve-review.cjs') $Port
exit $LASTEXITCODE
