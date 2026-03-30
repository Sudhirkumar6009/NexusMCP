param(
  [int]$Port = 8010,
  [switch]$SkipSetup
)

$ErrorActionPreference = "Stop"

$servicesRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $servicesRoot
$venvPython = Join-Path $repoRoot ".venv\Scripts\python.exe"
$setupScript = Join-Path $servicesRoot "setup-python-services.ps1"
$agenticRoot = Join-Path $servicesRoot "agentic"

if (-not $SkipSetup) {
  & $setupScript
}

if (-not (Test-Path $venvPython)) {
  throw "Missing Python interpreter at $venvPython. Run setup script first."
}

Set-Location $agenticRoot

Write-Host "Starting Agentic service on http://localhost:$Port"
Write-Host "Health endpoint: http://localhost:$Port/health"
Write-Host ""

& $venvPython -m uvicorn src.server:app --host 0.0.0.0 --port $Port --reload
