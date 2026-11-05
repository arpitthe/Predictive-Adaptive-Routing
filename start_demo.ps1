<#
.SYNOPSIS
    Predictive Adaptive Routing - Quick Launcher Script
.DESCRIPTION
    Opens three PowerShell terminal windows to launch the Python ML Service,
    Node.js Backend, and React Frontend in sequence.
#>

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  PREDICTIVE ADAPTIVE ROUTING - SYSTEM LAUNCHER           " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Verifying directories..." -ForegroundColor Yellow

$scriptRoot = $PSScriptRoot
$backendDir = Join-Path $scriptRoot "backend"
$frontendDir = Join-Path $scriptRoot "frontend"

if (-not (Test-Path $backendDir)) {
    Write-Host "[ERROR] Backend directory not found: $backendDir" -ForegroundColor Red
    exit 1
}

Write-Host "[1/3] Launching Python FastAPI ML Service (Port 8000)..." -ForegroundColor Green
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$scriptRoot'; Write-Host 'Starting Python Prediction Layer...'; uvicorn src.api:app --host 127.0.0.1 --port 8000 --workers 1"

Start-Sleep -Seconds 2

Write-Host "[2/3] Launching Node.js Orchestrator Backend (Port 5001)..." -ForegroundColor Green
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$backendDir'; Write-Host 'Starting Node.js Backend...'; npm run dev"

Start-Sleep -Seconds 2

Write-Host "[3/3] Launching React Frontend Console (Port 3000)..." -ForegroundColor Green
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$frontendDir'; Write-Host 'Starting React Frontend Console...'; npm run dev"

Write-Host ""
Write-Host "All service terminals dispatched successfully!" -ForegroundColor Cyan
Write-Host "Open your browser at: http://localhost:3000" -ForegroundColor White
Write-Host "Backend Health URL:  http://localhost:5001/api/health" -ForegroundColor Gray
Write-Host "Python Health URL:   http://localhost:8000/health" -ForegroundColor Gray
Write-Host "==========================================================" -ForegroundColor Cyan

