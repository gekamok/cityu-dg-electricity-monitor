$ErrorActionPreference = 'Stop'

$source = $PSScriptRoot
$root = Join-Path $env:LOCALAPPDATA 'CityUDGElectricityMonitor'
$app = Join-Path $root 'app'
$data = Join-Path $root 'data'
$profile = Join-Path $root 'edge-profile'

Write-Host 'CityU(DG) OneBill Electricity Monitor'
Write-Host '-------------------------------------'

$nodeCmd = Get-Command node.exe -ErrorAction SilentlyContinue
$npmCmd = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $nodeCmd -or -not $npmCmd) {
  throw '未检测到 Node.js/npm。请先安装 Node.js 22.5 或更高版本。'
}

$version = & $nodeCmd.Source -p "process.versions.node"
$parts = $version.Split('.')
$major = [int]$parts[0]
$minor = [int]$parts[1]
if ($major -lt 22 -or ($major -eq 22 -and $minor -lt 5)) {
  throw 'Node.js 版本过低。请安装 Node.js 22.5 或更高版本。'
}

$edge = @(
  "$env:ProgramFiles(x86)\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if (-not $edge) {
  throw '未检测到 Microsoft Edge。'
}

New-Item -ItemType Directory -Force -Path $app,$data,$profile | Out-Null

$files = @(
  'monitor.cjs','dashboard.cjs','store.cjs','sampler.cjs','auth.cjs',
  'reauth.cjs','login.cjs','edge-session.cjs','onebill-auth.cjs','dpapi.ps1','package.json','package-lock.json'
)
foreach($file in $files) {
  Copy-Item (Join-Path $source $file) (Join-Path $app $file) -Force
}

Write-Host ''
Write-Host '[1/4] 安装运行依赖...'
Push-Location $app
try {
  & $npmCmd.Source ci --omit=dev --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw 'npm ci 失败。' }
} finally {
  Pop-Location
}

Write-Host ''
Write-Host '[2/4] 首次登录绑定...'
Write-Host '即将打开一个独立 Edge 窗口。请在学校 OneBill 页面正常登录；程序不会读取或保存你的密码。'
& $nodeCmd.Source (Join-Path $app 'login.cjs')
if ($LASTEXITCODE -ne 0) {
  throw '登录绑定失败。请确认可以正常访问 OneBill 后重新运行 install.ps1。'
}

Write-Host ''
Write-Host '[3/4] 注册开机自启...'
$taskName = 'CityU(DG) Electricity Monitor'
$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existing) {
  Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
}

$action = New-ScheduledTaskAction -Execute $nodeCmd.Source -Argument ('"' + (Join-Path $app 'monitor.cjs') + '"') -WorkingDirectory $app
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Description 'Unofficial CityU(DG) OneBill electricity monitor' -Force | Out-Null
Start-ScheduledTask -TaskName $taskName

Write-Host ''
Write-Host '[4/4] 创建桌面入口...'
$desktop = [Environment]::GetFolderPath('Desktop')
$shortcut = Join-Path $desktop '港城莞电量监控.url'
@"
[InternetShortcut]
URL=http://127.0.0.1:17890/
IconFile=$env:SystemRoot\System32\shell32.dll
IconIndex=220
"@ | Set-Content -Path $shortcut -Encoding ASCII

Start-Sleep -Seconds 3
Start-Process 'http://127.0.0.1:17890/'

Write-Host ''
Write-Host '安装完成。'
Write-Host '仪表盘：http://127.0.0.1:17890/'
Write-Host "本地数据：$data"
Write-Host '默认采样：每 60 秒'
Write-Host '默认保留：400 天'
