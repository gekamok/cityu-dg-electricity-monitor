param(
  [switch]$PurgeData
)

$taskName = 'CityU(DG) Electricity Monitor'
$root = Join-Path $env:LOCALAPPDATA 'CityUDGElectricityMonitor'

Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue

Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -match 'CityUDGElectricityMonitor.*monitor\.cjs' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

Write-Host '已停止并删除计划任务。'

if ($PurgeData) {
  Remove-Item $root -Recurse -Force -ErrorAction SilentlyContinue
  Write-Host '本地历史数据、登录状态和运行文件也已删除。'
} else {
  Write-Host "历史数据和登录状态仍保留在：$root"
  Write-Host '如需彻底删除，请运行：.\uninstall.ps1 -PurgeData'
}
