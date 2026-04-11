param(
  [switch]$SkipDependencyInstall
)

$ErrorActionPreference = "Stop"

$servicesRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $servicesRoot
$venvPath = Join-Path $repoRoot ".venv"
$requirementsFile = Join-Path $servicesRoot "requirements-all.txt"

function Get-VenvPythonPath {
  param([string]$Path)

  $windowsPath = Join-Path $Path "Scripts\python.exe"
  if (Test-Path $windowsPath) {
    return $windowsPath
  }

  $posixPath = Join-Path $Path "bin/python"
  if (Test-Path $posixPath) {
    return $posixPath
  }

  return $windowsPath
}

$venvPython = Get-VenvPythonPath -Path $venvPath

function Invoke-VenvPython {
  param([string[]]$Arguments)

  if (-not (Test-Path $venvPython)) {
    throw "Missing Python interpreter at $venvPython. Virtual environment setup did not complete successfully."
  }

  & $venvPython @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Python command failed: $venvPython $($Arguments -join ' ')"
  }
}

function Invoke-VenvPythonWithRetry {
  param(
    [string[]]$Arguments,
    [int]$MaxAttempts = 3
  )

  for ($attempt = 1; $attempt -le $MaxAttempts; $attempt++) {
    try {
      Invoke-VenvPython -Arguments $Arguments
      return
    }
    catch {
      if ($attempt -ge $MaxAttempts) {
        throw
      }

      Write-Warning "Command failed on attempt $attempt/$MaxAttempts. Retrying: $venvPython $($Arguments -join ' ')"
    }
  }
}

function Invoke-BasePython {
  param([string[]]$Arguments)

  $pyLauncher = Get-Command py -ErrorAction SilentlyContinue
  if ($pyLauncher) {
    foreach ($selector in @("-3.11", "-3.12", "-3.13", "-3")) {
      $null = & py $selector "-c" "import sys; raise SystemExit(0 if sys.version_info >= (3, 11) else 1)" *>$null
      if ($LASTEXITCODE -ne 0) {
        continue
      }

      & py $selector @Arguments
      if ($LASTEXITCODE -eq 0) {
        return
      }

      throw "Python command failed: py $selector $($Arguments -join ' ')"
    }
  }

  $python = Get-Command python -ErrorAction SilentlyContinue
  if ($python) {
    & python "-c" "import sys; raise SystemExit(0 if sys.version_info >= (3, 11) else 1)"
    if ($LASTEXITCODE -ne 0) {
      throw "Detected 'python' command is not Python 3.11+. Install Python 3.11+ and retry."
    }

    & python @Arguments
    if ($LASTEXITCODE -eq 0) {
      return
    }

    throw "Python command failed: python $($Arguments -join ' ')"
  }

  throw "Python 3.11+ was not found. Install Python 3.11+ and retry. If using py launcher, run 'py -0p' to list installed versions."
}

if (-not (Test-Path $venvPython)) {
  Write-Host "Creating virtual environment at $venvPath"
  Invoke-BasePython -Arguments @("-m", "venv", $venvPath)

  $venvPython = Get-VenvPythonPath -Path $venvPath
  if (-not (Test-Path $venvPython)) {
    throw "Virtual environment creation failed. Expected interpreter was not found in $venvPath."
  }
}

$null = & $venvPython "-c" "import sys; raise SystemExit(0 if sys.version_info >= (3, 11) else 1)" *>$null
if ($LASTEXITCODE -ne 0) {
  throw "Virtual environment Python is unavailable or below Python 3.11 at $venvPython"
}

if (-not (Test-Path $requirementsFile)) {
  throw "Missing requirements file: $requirementsFile"
}

if (-not $SkipDependencyInstall) {
  Write-Host "Installing Python dependencies for all services..."
  Invoke-VenvPythonWithRetry -Arguments @("-m", "pip", "install", "--upgrade", "pip")

  Push-Location $servicesRoot
  try {
    Invoke-VenvPythonWithRetry -Arguments @("-m", "pip", "install", "-r", $requirementsFile)
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
