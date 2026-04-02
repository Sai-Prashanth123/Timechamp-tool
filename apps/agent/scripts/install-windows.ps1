# TimeChamp Agent — Windows Service Installer
# Run as Administrator: .\install-windows.ps1 -InviteToken "your-token-here"

param(
    [Parameter(Mandatory=$true)]
    [string]$InviteToken,

    [string]$InstallDir = "$env:ProgramFiles\TimeChamp",
    [string]$ApiUrl = "https://api.timechamp.io/api/v1"
)

$ErrorActionPreference = "Stop"

Write-Host "Installing TimeChamp Agent..." -ForegroundColor Cyan

# Create install directory
if (-not (Test-Path $InstallDir)) {
    New-Item -ItemType Directory -Path $InstallDir | Out-Null
}

# Copy binaries (assumes they are in the same directory as this script)
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Copy-Item "$scriptDir\..\dist\windows\timechamp-agent.exe" "$InstallDir\timechamp-agent.exe" -Force
Copy-Item "$scriptDir\..\dist\windows\timechamp-watchdog.exe" "$InstallDir\timechamp-watchdog.exe" -Force

Write-Host "Binaries installed to $InstallDir"

# Set environment variables for the service
[System.Environment]::SetEnvironmentVariable("TC_INVITE_TOKEN", $InviteToken, "Machine")
[System.Environment]::SetEnvironmentVariable("TC_API_URL", $ApiUrl, "Machine")

# Register watchdog as a Windows Service using sc.exe
$serviceName = "TimeChampAgent"
$serviceDisplay = "TimeChamp Agent"
$watchdogPath = "$InstallDir\timechamp-watchdog.exe"

# Remove existing service if present
$existing = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
if ($existing) {
    Stop-Service -Name $serviceName -Force -ErrorAction SilentlyContinue
    sc.exe delete $serviceName | Out-Null
    Start-Sleep -Seconds 2
}

sc.exe create $serviceName `
    binPath= "`"$watchdogPath`"" `
    DisplayName= $serviceDisplay `
    start= auto `
    obj= "LocalSystem" | Out-Null

sc.exe description $serviceName "TimeChamp workforce intelligence agent" | Out-Null

Start-Service -Name $serviceName
Write-Host "Service '$serviceName' installed and started." -ForegroundColor Green

# Clear the invite token — it's single-use, don't leave it in the environment
[System.Environment]::SetEnvironmentVariable("TC_INVITE_TOKEN", $null, "Machine")
Write-Host "Invite token cleared from environment."

# Verify
$svc = Get-Service -Name $serviceName
Write-Host "Service status: $($svc.Status)"
