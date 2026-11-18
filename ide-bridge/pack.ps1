# Builds ide-bridge\hud-bridge-<version>.vsix (no npm / vsce needed).
# Install:  & "$env:LOCALAPPDATA\Programs\Antigravity IDE\bin\antigravity-ide.cmd" --install-extension .\ide-bridge\hud-bridge-0.1.0.vsix
#     (VS Code:  code --install-extension .\ide-bridge\hud-bridge-0.1.0.vsix)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$pkg = Get-Content (Join-Path $here 'package.json') -Raw | ConvertFrom-Json
$out = Join-Path $here ("hud-bridge-{0}.vsix" -f $pkg.version)
if (Test-Path $out) { Remove-Item $out -Force }

$manifest = @"
<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011" xmlns:d="http://schemas.microsoft.com/developer/vsx-schema-design/2011">
  <Metadata>
    <Identity Language="en-US" Id="$($pkg.name)" Version="$($pkg.version)" Publisher="$($pkg.publisher)" />
    <DisplayName>$($pkg.displayName)</DisplayName>
    <Description xml:space="preserve">$([System.Security.SecurityElement]::Escape($pkg.description))</Description>
    <Categories>Other</Categories>
    <GalleryFlags>Public</GalleryFlags>
    <Properties>
      <Property Id="Microsoft.VisualStudio.Code.Engine" Value="$($pkg.engines.vscode)" />
    </Properties>
  </Metadata>
  <Installation><InstallationTarget Id="Microsoft.VisualStudio.Code" /></Installation>
  <Dependencies />
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true" />
  </Assets>
</PackageManifest>
"@
$types = '<?xml version="1.0" encoding="utf-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension=".json" ContentType="application/json" /><Default Extension=".js" ContentType="application/javascript" /><Default Extension=".md" ContentType="text/markdown" /><Default Extension=".vsixmanifest" ContentType="text/xml" /></Types>'

$zip = [System.IO.Compression.ZipFile]::Open($out, 'Create')
try {
  function Add-Text($name, $text) {
    $e = $zip.CreateEntry($name)
    $w = New-Object System.IO.StreamWriter($e.Open(), (New-Object System.Text.UTF8Encoding($false)))
    $w.Write($text); $w.Dispose()
  }
  Add-Text '[Content_Types].xml' $types
  Add-Text 'extension.vsixmanifest' $manifest
  foreach ($f in 'package.json', 'extension.js', 'README.md') {
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, (Join-Path $here $f), "extension/$f") | Out-Null
  }
} finally { $zip.Dispose() }
Write-Output $out
