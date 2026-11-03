# Builds the Microsoft Store package (unsigned .msix; the Store signs it when you submit).
# Run on Windows after `npx tauri build --no-bundle`. Values come from Partner Center → Product identity.
param(
  [Parameter(Mandatory)] [string] $IdentityName,     # e.g. EngineeringWorkspace.SurgeSpace
  [Parameter(Mandatory)] [string] $Publisher,        # e.g. CN=1A2B3C4D-....
  [Parameter(Mandatory)] [string] $PublisherDisplay, # e.g. Engineering Workspace
  [string] $Version = "1.0.0.0"
)
$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
$layout = Join-Path $root "msix\layout"
Remove-Item $layout -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path "$layout\assets" | Out-Null
Copy-Item "$root\src-tauri\target\release\surgespace.exe" "$layout\SurgeSpace.exe"
foreach ($f in "StoreLogo.png","Square44x44Logo.png","Square71x71Logo.png","Square150x150Logo.png","Square310x310Logo.png") {
  Copy-Item "$root\src-tauri\icons\$f" "$layout\assets\$f"
}
(Get-Content "$root\msix\AppxManifest.xml" -Raw) `
  -replace '\{\{IDENTITY_NAME\}\}', $IdentityName `
  -replace '\{\{PUBLISHER\}\}', $Publisher `
  -replace '\{\{PUBLISHER_DISPLAY\}\}', $PublisherDisplay `
  -replace '\{\{VERSION\}\}', $Version | Set-Content "$layout\AppxManifest.xml" -Encoding UTF8
$sdk = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin\*\x64\makeappx.exe" | Sort-Object FullName -Descending | Select-Object -First 1
& $sdk.FullName pack /d $layout /p "$root\msix\SurgeSpace_$Version.msix" /o
Write-Host "Package: msix\SurgeSpace_$Version.msix — upload it in Partner Center (Packages)."
