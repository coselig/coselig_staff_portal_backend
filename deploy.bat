@echo off
rem Usage: deploy.bat [version] [build_number]
rem If no args provided, version is read from ../coselig_staff_portal_frontend/pubspec.yaml

setlocal EnableDelayedExpansion

set SCRIPT_DIR=%~dp0
set PUBSPEC=%SCRIPT_DIR%..\coselig_staff_portal_frontend\pubspec.yaml

if "%~1"=="" (
    for /f "usebackq delims=" %%v in (`powershell -NoProfile -Command "(Select-String -Path '%PUBSPEC%' -Pattern '^version:\s*(\S+)' ).Matches[0].Groups[1].Value"`) do set FULLVER=%%v
    for /f "tokens=1,2 delims=+" %%a in ("!FULLVER!") do (
        set VERSION=%%a
        set BUILD_NUMBER=%%b
    )
    if "!BUILD_NUMBER!"=="" set BUILD_NUMBER=1
) else (
    set VERSION=%~1
    if "%~2"=="" (
        set BUILD_NUMBER=1
    ) else (
        set BUILD_NUMBER=%~2
    )
)

echo ======================================
echo Coselig 員工系統自動部署
echo 版本: !VERSION! (Build #!BUILD_NUMBER!)
echo ======================================

echo.
echo [1/4] 構建 Flutter 前端...
cd /d %SCRIPT_DIR%..\coselig_staff_portal_frontend
echo Running: flutter build web --release --build-name=!VERSION! --build-number=!BUILD_NUMBER!
flutter build web --release --build-name=!VERSION! --build-number=!BUILD_NUMBER!
if errorlevel 1 (
        echo 構建失敗！
        pause
        exit /b 1
)

echo.
echo [2/4] 生成資產清單...
cd /d %SCRIPT_DIR%..\coselig_staff_portal_backend
node upload.js
if errorlevel 1 (
        echo 生成資產清單失敗！
        pause
        exit /b 1
)

echo.
echo [3/4] 上傳靜態文件到 KV...
npx wrangler kv bulk put assets.json --namespace-id e7ff4caa1f96456aadc4c1c5bf71b584 --remote
if errorlevel 1 (
        echo 上傳失敗！
        pause
        exit /b 1
)

echo.
echo [4/4] 部署 Workers...
npx wrangler deploy
if errorlevel 1 (
        echo 部署失敗！
        pause
        exit /b 1
)

echo.
echo ======================================
echo 部署成功！版本: !VERSION! (Build #!BUILD_NUMBER!)
echo 訪問: https://employeeservice.coseligtest.workers.dev
echo ======================================

echo.
echo 更新版本號...
set /a NEXT_BUILD_NUMBER=!BUILD_NUMBER! + 1
set NEXT_VERSION=!VERSION!+!NEXT_BUILD_NUMBER!
powershell -NoProfile -Command "(Get-Content '%PUBSPEC%') -replace '^version:\s*\S+', 'version: !NEXT_VERSION!' | Set-Content '%PUBSPEC%'"
echo 下次部署版本將為: !NEXT_VERSION!

pause
