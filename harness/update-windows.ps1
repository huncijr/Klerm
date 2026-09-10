param(
	[switch]$Desktop,
	[switch]$NoAdminDesktopToolchain,
	[switch]$Pull,
	[switch]$NoLink,
	[switch]$Watch
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
$stampPath = Join-Path $cacheDir "windows-deps.stamp"
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

function Use-LocalNode {
	$nodeRoot = Join-Path $toolsDir "node-v$nodeVersion-win-x64"
	if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") {
		$nodeRoot = Join-Path $toolsDir "node-v$nodeVersion-win-arm64"
	}
	if (Test-Path -LiteralPath (Join-Path $nodeRoot "node.exe")) {
		$env:Path = "$nodeRoot;$env:Path"
	}
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

function Use-WindowsMsvcSysroot {
	$sysroot = Join-Path $env:LOCALAPPDATA "cargo-xwin\windows-msvc-sysroot\windows-msvc-sysroot"
	$libPath = Join-Path $sysroot "lib\x86_64-unknown-windows-msvc"
	$includePath = Join-Path $sysroot "include"
	if (Test-Path -LiteralPath $libPath) {
		$env:LIB = if ($env:LIB) { "$libPath;$env:LIB" } else { $libPath }
	}
	if (Test-Path -LiteralPath $includePath) {
		$env:INCLUDE = if ($env:INCLUDE) { "$includePath;$env:INCLUDE" } else { $includePath }
	}
}

function Import-CurrentPath {
	$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
	$machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
	$env:Path = "$machinePath;$userPath"
	$cargoBin = Join-Path $env:USERPROFILE ".cargo\bin"
	if (Test-Path -LiteralPath $cargoBin) {
		$env:Path = "$cargoBin;$env:Path"
	}
	Use-LocalNode
	Use-LocalLlvm
	Use-LocalCargoXwin
	Use-LocalLldLink
	Use-WindowsMsvcSysroot
	$env:Path = "$(Join-Path $harnessDir "scripts");$env:Path"
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

function Get-DependencyStamp {
	$files = @()
	$files += Get-Item -LiteralPath (Join-Path $harnessDir "package-lock.json")
	$files += Get-Item -LiteralPath (Join-Path $harnessDir "package.json")
	$files += Get-ChildItem -LiteralPath (Join-Path $harnessDir "packages") -Filter "package.json" -Recurse

	$hashes = $files |
		Sort-Object FullName |
		ForEach-Object { "{0}:{1}" -f $_.FullName.Substring($harnessDir.Length), (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash }

	return ($hashes -join "`n")
}

function Invoke-WindowsBuild {
	Sync-SourceToLocalBuild
	Push-Location $harnessDir
	try {
		New-Item -ItemType Directory -Force -Path $npmCacheDir | Out-Null
		Import-CurrentPath

		Assert-Command "node" "Run .\setup-windows.ps1 -InstallTools once, or install Node.js 22.19+ from https://nodejs.org/."
		Assert-Command "npm.cmd" "Run .\setup-windows.ps1 -InstallTools once, or install npm with Node.js 22.19+."
		Assert-NodeVersion

		if ($Pull) {
			if (Get-Command git -ErrorAction SilentlyContinue) {
				Write-Host "Pulling latest source..."
				& git pull --ff-only
				if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
			} else {
				Write-Host "Git is not available; skipping pull."
			}
		}

		$currentStamp = Get-DependencyStamp
		$oldStamp = if (Test-Path -LiteralPath $stampPath) { Get-Content -LiteralPath $stampPath -Raw } else { "" }
		$nodeModulesPath = Join-Path $harnessDir "node_modules"

		if ((-not (Test-Path -LiteralPath $nodeModulesPath)) -or ($currentStamp -ne $oldStamp)) {
			Write-Host "Dependencies changed or missing; running npm install once..."
			Invoke-NpmCommand "install --ignore-scripts --cache `"$npmCacheDir`""
			Set-Content -LiteralPath $stampPath -Value $currentStamp -NoNewline
		} else {
			Write-Host "Dependencies are unchanged; skipping npm install."
		}

		Ensure-ModelData

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
			Write-Host "Building Windows desktop package..."
			if ($NoAdminDesktopToolchain) {
				$runnerPath = Join-Path $harnessDir "scripts\cargo-xwin-clang.cmd"
				Invoke-NpmCommand "--workspace=@klerm/desktop run tauri -- build --runner `"$runnerPath`" --target x86_64-pc-windows-msvc --no-bundle --ci"
			} else {
				Invoke-NpmCommand "run tauri:build"
			}
		} else {
			Write-Host "Building Windows CLI..."
			Invoke-NpmCommand "run build:offline"
		}

		if (-not $NoLink) {
			Write-Host "Linking local klerm command..."
			Invoke-NpmCommand "link --ignore-scripts --workspace=@earendil-works/pi-coding-agent"
		}
	} finally {
		Pop-Location
	}
}

if ($Watch) {
	Write-Host "Watching source changes. Press Ctrl+C to stop."
	Invoke-WindowsBuild

	$watcher = New-Object System.IO.FileSystemWatcher
	$watcher.Path = $sourceDir
	$watcher.IncludeSubdirectories = $true
	$watcher.EnableRaisingEvents = $true
	$watcher.Filter = "*.*"

	$lastRun = Get-Date
	$action = {
		$path = $Event.SourceEventArgs.FullPath
		if ($path -match "\\(node_modules|dist|target|\.cache|\.git)\\") { return }
		$now = Get-Date
		if (($now - $script:lastRun).TotalSeconds -lt 2) { return }
		$script:lastRun = $now
		Write-Host "Change detected; rebuilding..."
		Invoke-WindowsBuild
	}

	Register-ObjectEvent $watcher Changed -Action $action | Out-Null
	Register-ObjectEvent $watcher Created -Action $action | Out-Null
	Register-ObjectEvent $watcher Deleted -Action $action | Out-Null
	Register-ObjectEvent $watcher Renamed -Action $action | Out-Null

	while ($true) { Start-Sleep -Seconds 1 }
} else {
	Invoke-WindowsBuild
}
