param(
  [switch]$SkipDependencyInstall
)

$ErrorActionPreference = "Stop"

$servicesRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $servicesRoot
$venvPath = Join-Path $repoRoot ".venv"
$venvPython = Join-Path $venvPath "Scripts\python.exe"
$requirementsFile = Join-Path $servicesRoot "requirements-all.txt"

function Invoke-VenvPython {
  param([string[]]$Arguments)

  & $venvPython @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Python command failed: $venvPython $($Arguments -join ' ')"
  }
}

function Invoke-BasePython {
  param([string[]]$Arguments)

  $pyLauncher = Get-Command py -ErrorAction SilentlyContinue
  if ($pyLauncher) {
    & py -3.11 @Arguments
    return
  }

  $python = Get-Command python -ErrorAction SilentlyContinue
  if ($python) {
    & python @Arguments
    return
  }

  throw "Python 3.11+ was not found. Install Python and retry."
}

if (-not (Test-Path $venvPython)) {
  Write-Host "Creating virtual environment at $venvPath"
  Invoke-BasePython -Arguments @("-m", "venv", $venvPath)
}

if (-not (Test-Path $requirementsFile)) {
  throw "Missing requirements file: $requirementsFile"
}

if (-not $SkipDependencyInstall) {
  Write-Host "Installing Python dependencies for all services..."
  Invoke-VenvPython -Arguments @("-m", "pip", "install", "--upgrade", "pip")

  Push-Location $servicesRoot
  try {
    Invoke-VenvPython -Arguments @("-m", "pip", "install", "-r", $requirementsFile)
  }
  finally {
    Pop-Location
  }
}

$agenticEnvExample = Join-Path $servicesRoot "agentic\.env.example"
$agenticEnv = Join-Path $servicesRoot "agentic\.env"
if ((Test-Path $agenticEnvExample) -and -not (Test-Path $agenticEnv)) {
  Copy-Item $agenticEnvExample $agenticEnv
  Write-Host "Created agentic env file at $agenticEnv"
}

$mcpEnvExample = Join-Path $servicesRoot "mcp-connectors\.env.example"
$mcpEnv = Join-Path $servicesRoot "mcp-connectors\.env"
if ((Test-Path $mcpEnvExample) -and -not (Test-Path $mcpEnv)) {
  Copy-Item $mcpEnvExample $mcpEnv
  Write-Host "Created mcp-connectors env file at $mcpEnv"
}

$apiEnv = Join-Path $repoRoot "apps\api\.env"
if (Test-Path $apiEnv) {
  $apiEnvText = Get-Content $apiEnv -Raw
  if ($apiEnvText -notmatch "(?m)^AGENTIC_SERVICE_URL=") {
    Write-Warning "apps/api/.env is missing AGENTIC_SERVICE_URL. Add AGENTIC_SERVICE_URL=http://localhost:8010"
  }
}
else {
  Write-Warning "apps/api/.env not found. Copy apps/api/.env.example and set AGENTIC_SERVICE_URL=http://localhost:8010"
}

$clientEnv = Join-Path $repoRoot "apps\client\.env"
if (Test-Path $clientEnv) {
  $clientEnvText = Get-Content $clientEnv -Raw
  if ($clientEnvText -notmatch "(?m)^NEXT_PUBLIC_API_URL=") {
    Write-Warning "apps/client/.env is missing NEXT_PUBLIC_API_URL. Add NEXT_PUBLIC_API_URL=http://localhost:3000/api"
  }
}
else {
  Write-Warning "apps/client/.env not found. Copy apps/client/.env.example and set NEXT_PUBLIC_API_URL=http://localhost:3000/api"
}

Write-Host ""
Write-Host "Python services environment is ready."
Write-Host "Venv: $venvPath"
Write-Host "Interpreter: $venvPython"
Write-Host ""
Write-Host "Next steps:"
Write-Host "1) Set GEMINI_API_KEY in services/agentic/.env"
Write-Host "2) Run: powershell -ExecutionPolicy Bypass -File services/start-agentic.ps1"
