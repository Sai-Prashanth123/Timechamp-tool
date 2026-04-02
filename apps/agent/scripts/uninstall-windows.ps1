# TimeChamp Agent — Windows Uninstaller
# Run as Administrator

param(
    [string]$InstallDir = "$env:ProgramFiles\TimeChamp"
)

$ErrorActionPreference = "Stop"
$serviceName = "TimeChampAgent"

Write-Host "Uninstalling TimeChamp Agent..." -ForegroundColor Yellow

# Stop and remove service
$existing = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
if ($existing) {
    Stop-Service -Name $serviceName -Force -ErrorAction SilentlyContinue
    sc.exe delete $serviceName | Out-Null
    Write-Host "Service removed."
}

# Remove environment variables
[System.Environment]::SetEnvironmentVariable("TC_INVITE_TOKEN", $null, "Machine")
[System.Environment]::SetEnvironmentVariable("TC_API_URL", $null, "Machine")

# Remove install directory
if (Test-Path $InstallDir) {
    Remove-Item -Path $InstallDir -Recurse -Force
    Write-Host "Files removed from $InstallDir"
}

Write-Host "TimeChamp Agent uninstalled." -ForegroundColor Green
