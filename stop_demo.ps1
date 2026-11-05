<#
.SYNOPSIS
    Predictive Adaptive Routing - System Shutdown Script
.DESCRIPTION
    Safely terminates running processes on ports 3000, 5001, and 8000.
#>

Write-Host "Shutting down Predictive Adaptive Routing services..." -ForegroundColor Yellow

$ports = @(3000, 5001, 8000)

foreach ($port in $ports) {
    try {
        $connections = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
        if ($connections) {
            $pids = $connections | Select-Object -ExpandProperty OwningProcess -Unique
            foreach ($procId in $pids) {
                if ($procId -gt 0) {
                    Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
                    Write-Host "Terminated process $procId listening on port $port" -ForegroundColor Green
                }
            }
        } else {
            Write-Host "Port $port is already clear." -ForegroundColor Gray
        }
    } catch {
        Write-Host "Could not inspect port $port." -ForegroundColor DarkGray
    }
}

Write-Host "Shutdown complete." -ForegroundColor Cyan

