param(
  [Parameter(Mandatory=$true)]
  [ValidateSet('protect','unprotect')]
  [string]$Mode
)

$ErrorActionPreference = 'Stop'
$inputText = [Console]::In.ReadToEnd()

if ($Mode -eq 'protect') {
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($inputText)
  $encrypted = [System.Security.Cryptography.ProtectedData]::Protect(
    $bytes,
    $null,
    [System.Security.Cryptography.DataProtectionScope]::CurrentUser
  )
  [Console]::Out.Write([Convert]::ToBase64String($encrypted))
  exit 0
}

$encryptedBytes = [Convert]::FromBase64String($inputText.Trim())
$plainBytes = [System.Security.Cryptography.ProtectedData]::Unprotect(
  $encryptedBytes,
  $null,
  [System.Security.Cryptography.DataProtectionScope]::CurrentUser
)
[Console]::Out.Write([System.Text.Encoding]::UTF8.GetString($plainBytes))
