param([string]$ToolingRoot=$env:OFFICINA_ANDROID_TOOLS,[switch]$SkipWeb,[switch]$Verify)
$ErrorActionPreference='Stop'
$repoRoot=Split-Path -Parent $PSScriptRoot
if(-not $ToolingRoot){$ToolingRoot=Join-Path $repoRoot './.tooling'}
$ToolingRoot=(Resolve-Path -LiteralPath $ToolingRoot).Path
$env:JAVA_HOME=(Get-ChildItem -LiteralPath (Join-Path $ToolingRoot 'java') -Directory | Select-Object -First 1).FullName
$env:ANDROID_HOME=Join-Path $ToolingRoot 'android-sdk'
$env:ANDROID_SDK_ROOT=$env:ANDROID_HOME
$env:GRADLE_USER_HOME=Join-Path $ToolingRoot 'gradle-cache'
$gradle=Join-Path $ToolingRoot 'gradle/gradle-8.13/bin/gradle.bat'
foreach($required in @($gradle,(Join-Path $env:JAVA_HOME 'bin/javac.exe'),(Join-Path $env:ANDROID_HOME 'platforms/android-36/android.jar'))){if(-not(Test-Path -LiteralPath $required)){throw "Strumento mancante: $required"}}
Push-Location $repoRoot
try{
 if($Verify){& node --test tests/portable.test.mjs tests/drive-sync.test.mjs;if($LASTEXITCODE -ne 0){throw 'Fixture e test di trasferimento/Drive non riusciti'}}
 if(-not $SkipWeb){& npm run build:mobile;if($LASTEXITCODE -ne 0){throw 'Build interfaccia mobile non riuscita'}}
 $sdkPath=$env:ANDROID_HOME.Replace('\','/').Replace(':','\:')
 [System.IO.File]::WriteAllText((Join-Path $repoRoot 'android/local.properties'),"sdk.dir=$sdkPath`n",[System.Text.UTF8Encoding]::new($false))
 Push-Location (Join-Path $repoRoot 'android')
 try{if($Verify){& $gradle --no-daemon --console=plain assembleDebug testDebugUnitTest lintDebug}else{& $gradle --no-daemon --console=plain assembleDebug};if($LASTEXITCODE -ne 0){throw 'Build Android non completata'}}finally{Pop-Location}
 if($Verify){& node scripts/verify-android-roundtrip.mjs;if($LASTEXITCODE -ne 0){throw 'Scambio Java Android verso PC non verificato'};& node scripts/verify-drive-java.mjs;if($LASTEXITCODE -ne 0){throw 'Scambio Drive Java verso PC non verificato'}}
 $source=Join-Path $repoRoot 'android/app/build/outputs/apk/debug/app-debug.apk'
 $destination=Join-Path $repoRoot 'release/Officina-Libri-Android-0.1.4-prova.apk'
 New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destination) | Out-Null
 Copy-Item -LiteralPath $source -Destination $destination -Force
 $sourceHash=(Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash
 $destinationHash=(Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash
 if($sourceHash -ne $destinationHash){throw 'Copia APK non integra'}
 & (Join-Path $env:ANDROID_HOME 'build-tools/35.0.0/apksigner.bat') verify --verbose $destination
 if($LASTEXITCODE -ne 0){throw 'Firma APK non verificata'}
 Write-Output "APK: $destination"
 Write-Output "SHA-256: $destinationHash"
}finally{Pop-Location}
