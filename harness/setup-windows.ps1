param(
	[switch]$Desktop,
	[switch]$InstallTools,
	[switch]$NoAdminDesktopToolchain,
	[switch]$NoLink
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$sourceDir = $PSScriptRoot
$harnessDir = $sourceDir
if ($sourceDir.StartsWith("\\")) {
	$harnessDir = Join-Path $env:LOCALAPPDATA "Klerm\windows-build\harness"
}
$cacheDir = Join-Path $harnessDir ".cache"
$npmCacheDir = Join-Path $cacheDir "npm"
$toolsDir = Join-Path $cacheDir "tools"
$nodeVersion = "22.19.0"
$cargoXwinVersion = "0.23.1"
$llvmVersion = "23.1.1"

function Assert-Command($name, $installHint) {
	if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
		throw "$name is not available. $installHint"
	}
}

function Assert-NodeVersion {
	$versionText = (& node -p "process.versions.node").Trim()
	$version = [version]$versionText
	$minimum = [version]"22.19.0"
	if ($version -lt $minimum) {
		throw "Node.js $minimum or newer is required. Current version: $versionText"
	}
}

function Sync-SourceToLocalBuild {
	if ($sourceDir -eq $harnessDir) { return }
	New-Item -ItemType Directory -Force -Path $harnessDir | Out-Null
	Write-Host "Syncing source to local Windows build directory: $harnessDir"
	$sourceModelData = Join-Path $sourceDir "packages\ai\src\providers\data"
	$localModelData = Join-Path $harnessDir "packages\ai\src\providers\data"
	$robocopyArgs = @($sourceDir, $harnessDir, "/MIR", "/R:2", "/W:1", "/XD", "node_modules", ".cache", "dist", "target", ".git", $sourceModelData, $localModelData, "/XF", "*.log", "/NFL", "/NDL", "/NJH", "/NJS")
	& robocopy @robocopyArgs
	if ($LASTEXITCODE -gt 7) { exit $LASTEXITCODE }
}

function Install-WingetPackage($id, $extraArgs) {
	Assert-Command "winget" "Install App Installer from the Microsoft Store, then rerun this script."
	& winget list --id $id --exact | Out-Null
	if ($LASTEXITCODE -eq 0) {
		Write-Host "$id is already installed."
		return
	}

	Write-Host "Installing $id..."
	$args = @("install", "--id", $id, "--exact", "--accept-package-agreements", "--accept-source-agreements") + $extraArgs
	& winget @args
	if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

function Import-CurrentPath {
	$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
	$machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
	$env:Path = "$machinePath;$userPath"
	$cargoBin = Join-Path $env:USERPROFILE ".cargo\bin"
	if (Test-Path -LiteralPath $cargoBin) {
		$env:Path = "$cargoBin;$env:Path"
	}
}

function Use-LocalNode {
	$nodeRoot = Join-Path $toolsDir "node-v$nodeVersion-win-x64"
	if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") {
		$nodeRoot = Join-Path $toolsDir "node-v$nodeVersion-win-arm64"
	}
	if (Test-Path -LiteralPath (Join-Path $nodeRoot "node.exe")) {
		$env:Path = "$nodeRoot;$env:Path"
	}
}

function Install-LocalNode {
	$arch = if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { "arm64" } else { "x64" }
	$nodeName = "node-v$nodeVersion-win-$arch"
	$nodeRoot = Join-Path $toolsDir $nodeName
	if (Test-Path -LiteralPath (Join-Path $nodeRoot "node.exe")) {
		Use-LocalNode
		return
	}

	New-Item -ItemType Directory -Force -Path $toolsDir | Out-Null
	$zipPath = Join-Path $toolsDir "$nodeName.zip"
	$url = "https://nodejs.org/dist/v$nodeVersion/$nodeName.zip"
	Write-Host "Downloading portable Node.js $nodeVersion for Windows $arch..."
	Invoke-WebRequest -Uri $url -OutFile $zipPath
	Write-Host "Extracting portable Node.js..."
	Expand-Archive -LiteralPath $zipPath -DestinationPath $toolsDir -Force
	Use-LocalNode
}

function Use-LocalCargoXwin {
	$cargoXwinDir = Join-Path $toolsDir "cargo-xwin-v$cargoXwinVersion.windows-x64"
	if (Test-Path -LiteralPath (Join-Path $cargoXwinDir "cargo-xwin.exe")) {
		$env:Path = "$cargoXwinDir;$env:Path"
	}
}

function Use-LocalLlvm {
	$llvmRoot = Join-Path $toolsDir "clang+llvm-$llvmVersion-x86_64-pc-windows-msvc"
	$llvmBin = Join-Path $llvmRoot "bin"
	if (Test-Path -LiteralPath (Join-Path $llvmBin "clang.exe")) {
		$env:Path = "$llvmBin;$env:Path"
		$llvmRc = Join-Path $llvmBin "llvm-rc.exe"
		if (Test-Path -LiteralPath $llvmRc) {
			$env:RC = $llvmRc
			$env:RC_x86_64_pc_windows_msvc = $llvmRc
		}
	}
}

function Install-LocalLlvm {
	if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") {
		throw "No-admin desktop LLVM bootstrap currently supports x64 Windows hosts only."
	}

	$llvmName = "clang+llvm-$llvmVersion-x86_64-pc-windows-msvc"
	$llvmRoot = Join-Path $toolsDir $llvmName
	if (Test-Path -LiteralPath (Join-Path $llvmRoot "bin\clang.exe")) {
		Use-LocalLlvm
		return
	}

	New-Item -ItemType Directory -Force -Path $toolsDir | Out-Null
	$archivePath = Join-Path $toolsDir "$llvmName.tar.xz"
	$url = "https://github.com/llvm/llvm-project/releases/download/llvmorg-$llvmVersion/clang%2Bllvm-$llvmVersion-x86_64-pc-windows-msvc.tar.xz"
	Write-Host "Downloading portable LLVM/Clang $llvmVersion. This is a large one-time download..."
	Invoke-WebRequest -Uri $url -OutFile $archivePath
	Write-Host "Extracting portable LLVM/Clang..."
	& tar -xf $archivePath -C $toolsDir
	if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
	Use-LocalLlvm
}

function Use-LocalLldLink {
	$lldDir = Join-Path $toolsDir "lld-link"
	if (Test-Path -LiteralPath (Join-Path $lldDir "lld-link.exe")) {
		$env:Path = "$lldDir;$env:Path"
	}
}

function Install-LocalLldLink {
	$sysroot = (& rustc --print sysroot).Trim()
	$rustLld = Join-Path $sysroot "lib\rustlib\x86_64-pc-windows-msvc\bin\rust-lld.exe"
	if (-not (Test-Path -LiteralPath $rustLld)) {
		throw "rust-lld.exe was not found. Run rustup component add llvm-tools-preview."
	}
	$lldDir = Join-Path $toolsDir "lld-link"
	New-Item -ItemType Directory -Force -Path $lldDir | Out-Null
	Copy-Item -LiteralPath $rustLld -Destination (Join-Path $lldDir "lld-link.exe") -Force
	Use-LocalLldLink
}

function Install-LocalCargoXwin {
	if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") {
		throw "No-admin desktop toolchain currently supports x64 Windows hosts only."
	}

	$cargoXwinName = "cargo-xwin-v$cargoXwinVersion.windows-x64"
	$cargoXwinDir = Join-Path $toolsDir $cargoXwinName
	if (Test-Path -LiteralPath (Join-Path $cargoXwinDir "cargo-xwin.exe")) {
		Use-LocalCargoXwin
		return
	}

	New-Item -ItemType Directory -Force -Path $toolsDir | Out-Null
	$zipPath = Join-Path $toolsDir "$cargoXwinName.zip"
	$url = "https://github.com/rust-cross/cargo-xwin/releases/download/v$cargoXwinVersion/$cargoXwinName.zip"
	Write-Host "Downloading portable cargo-xwin $cargoXwinVersion..."
	Invoke-WebRequest -Uri $url -OutFile $zipPath
	Write-Host "Extracting portable cargo-xwin..."
	Expand-Archive -LiteralPath $zipPath -DestinationPath $cargoXwinDir -Force
	Use-LocalCargoXwin
}

function Invoke-NpmCommand($arguments, [switch]$AllowFailure) {
	$npmCmd = (Get-Command "npm.cmd").Source
	$command = "pushd `"$harnessDir`" && `"$npmCmd`" $arguments"
	& cmd.exe /d /s /c $command | Out-Host
	if ($AllowFailure) { return $LASTEXITCODE }
	if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

function Ensure-ModelData {
	Write-Host "Checking offline model data..."
	$checkExitCode = Invoke-NpmCommand "run check:model-data" -AllowFailure
	if ($checkExitCode -ne 0) {
		Write-Host "Hydrating offline model data once..."
		Invoke-NpmCommand "run hydrate:model-data"
	}
}

Sync-SourceToLocalBuild
Push-Location $harnessDir
try {
	New-Item -ItemType Directory -Force -Path $npmCacheDir | Out-Null
	Use-LocalNode

	if ($InstallTools) {
		Import-CurrentPath
		if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
			Install-LocalNode
		}
		if ($Desktop -and (-not $NoAdminDesktopToolchain) -and (-not (Get-Command rustup -ErrorAction SilentlyContinue)) -and (-not (Get-Command cargo -ErrorAction SilentlyContinue))) {
			Install-WingetPackage "Rustlang.Rustup" @()
		}
		if ($Desktop -and $NoAdminDesktopToolchain) {
			Install-LocalLlvm
			Install-LocalCargoXwin
		} elseif ($Desktop) {
			Install-WingetPackage "Microsoft.VisualStudio.2022.BuildTools" @("--override", "--quiet --wait --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended")
		}
		Import-CurrentPath
		Use-LocalNode
		Use-LocalLlvm
		Use-LocalCargoXwin
		Use-LocalLldLink
		$env:Path = "$(Join-Path $harnessDir "scripts");$env:Path"
	}

	Assert-Command "node" "Run .\setup-windows.ps1 -InstallTools once, or install Node.js 22.19+ from https://nodejs.org/."
	Assert-Command "npm.cmd" "Run .\setup-windows.ps1 -InstallTools once, or install npm with Node.js 22.19+."
	Assert-NodeVersion

	if ($Desktop) {
		Assert-Command "cargo" "Install Rust from https://rustup.rs/."
		if ($NoAdminDesktopToolchain) {
			Assert-Command "rustup" "Install Rust from https://rustup.rs/."
			Assert-Command "cargo-xwin" "Run .\setup-windows.ps1 -Desktop -InstallTools -NoAdminDesktopToolchain once."
			& rustup target add x86_64-pc-windows-msvc
			if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
			& rustup component add llvm-tools-preview
			if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
			Install-LocalLldLink
		}
	}

	Write-Host "Installing Node dependencies with project-local npm cache..."
	Invoke-NpmCommand "install --ignore-scripts --cache `"$npmCacheDir`""
	Ensure-ModelData

	if ($Desktop) {
		Write-Host "Fetching Rust/Tauri dependencies..."
		Push-Location (Join-Path $harnessDir "packages/desktop/src-tauri")
		try {
			& cargo fetch
			if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
		} finally {
			Pop-Location
		}
	}

	Write-Host "Building Klerm for Windows..."
	& "$harnessDir\update-windows.ps1" -Desktop:$Desktop -NoAdminDesktopToolchain:$NoAdminDesktopToolchain -NoLink:$NoLink
	if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
	Pop-Location
}
