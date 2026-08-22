# ============================================================================
# Bật toàn bộ hệ thống Auto Test HCC và mở link công khai qua ngrok.
# Chạy: bấm phải file này -> Run with PowerShell   (hoặc: powershell -File start-hosting.ps1)
# Mỗi lần chạy lại, ngrok cấp một URL MỚI - script sẽ in ra ở cuối.
# ============================================================================

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$py = Join-Path $root "backend\.venv\Scripts\python.exe"

function Test-Port($port) {
    try { (Test-NetConnection -ComputerName 127.0.0.1 -Port $port -WarningAction SilentlyContinue).TcpTestSucceeded }
    catch { $false }
}

Write-Host "== 1. Kiem tra cac dich vu phu thuoc ==" -ForegroundColor Cyan

# Docker: BE noi bo (12005) va Mongo cua he thong kia (12004)
if (Test-Port 12005) { Write-Host "  [OK] BE noi bo (12005)" -ForegroundColor Green }
else {
    Write-Host "  [!] BE noi bo (12005) chua chay. Dang thu bat Docker..." -ForegroundColor Yellow
    try { docker start auto-fill-hcc-backend-app-1 auto-fill-hcc-backend-mongo-1 2>$null | Out-Null } catch {}
    Start-Sleep 3
    if (Test-Port 12005) { Write-Host "  [OK] Da bat BE noi bo" -ForegroundColor Green }
    else { Write-Host "  [X] Van chua bat duoc BE noi bo - mo Docker Desktop roi chay lai." -ForegroundColor Red }
}

# Mongo cua app (27018) - luu lich su + tai khoan
if (Test-Port 27018) { Write-Host "  [OK] MongoDB cua app (27018)" -ForegroundColor Green }
else {
    Write-Host "  [!] Mongo (27018) chua chay. Dang bat..." -ForegroundColor Yellow
    try { docker start hcc-test-mongo 2>$null | Out-Null } catch {}
    Start-Sleep 2
    if (Test-Port 27018) { Write-Host "  [OK] Da bat Mongo" -ForegroundColor Green }
    else { Write-Host "  [X] Chua bat duoc Mongo." -ForegroundColor Red }
}

Write-Host ""
Write-Host "== 2. Cap nhat giao dien (build) ==" -ForegroundColor Cyan
Push-Location (Join-Path $root "frontend")
npm run build 2>&1 | Select-Object -Last 1
Pop-Location

Write-Host ""
Write-Host "== 3. Bat backend (cong 8000) ==" -ForegroundColor Cyan
if (Test-Port 8000) {
    Write-Host "  [OK] Backend da chay san" -ForegroundColor Green
} else {
    Start-Process -FilePath $py -ArgumentList "-m","uvicorn","app.main:app","--host","127.0.0.1","--port","8000" `
        -WorkingDirectory (Join-Path $root "backend") -WindowStyle Minimized
    for ($i=0; $i -lt 20 -and -not (Test-Port 8000); $i++) { Start-Sleep 1 }
    if (Test-Port 8000) { Write-Host "  [OK] Backend da len" -ForegroundColor Green }
    else { Write-Host "  [X] Backend khong len - kiem tra lai." -ForegroundColor Red; exit 1 }
}

Write-Host ""
Write-Host "== 4. Mo link cong khai qua ngrok ==" -ForegroundColor Cyan
# Tat ngrok cu neu con
Get-Process ngrok -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Process -FilePath "ngrok" -ArgumentList "http","8000","--log","stdout" -WindowStyle Minimized
Start-Sleep 4

# Lay URL tu ngrok local API
$url = $null
for ($i=0; $i -lt 15; $i++) {
    try {
        $t = Invoke-RestMethod -Uri "http://127.0.0.1:4040/api/tunnels" -TimeoutSec 3
        if ($t.tunnels.Count -gt 0) { $url = $t.tunnels[0].public_url; break }
    } catch {}
    Start-Sleep 1
}

Write-Host ""
if ($url) {
    Write-Host "==========================================================" -ForegroundColor Green
    Write-Host " LINK CHO MOI NGUOI VAO:" -ForegroundColor Green
    Write-Host "   $url" -ForegroundColor White
    Write-Host " Dang nhap: admin (mat khau trong backend/.env)" -ForegroundColor Green
    Write-Host "==========================================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "Lan dau vao se co trang canh bao ngrok -> bam 'Visit Site'." -ForegroundColor DarkGray
    Write-Host "GIU CUA SO NAY VA MAY BAT thi link con song. Dong la link chet." -ForegroundColor Yellow
    try { Set-Clipboard $url; Write-Host "(Da copy link vao clipboard)" -ForegroundColor DarkGray } catch {}
} else {
    Write-Host "[X] Khong lay duoc URL ngrok. Mo http://127.0.0.1:4040 de xem." -ForegroundColor Red
}

Write-Host ""
Write-Host "Nhan phim bat ky de dong cua so nay (link se dung)..." -ForegroundColor DarkGray
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
