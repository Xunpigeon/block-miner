# 一键上传到 GitHub
# 用法：右键「使用 PowerShell 运行」，或在 PowerShell 里  .\上传.ps1

$ErrorActionPreference = "Stop"
Set-Location "E:\项目\blockminer"

# 1) 未登录则先登录（只需一次，凭据会存下来）
gh auth status *> $null
if ($LASTEXITCODE -ne 0) {
  Write-Host "首次使用，请先登录 GitHub（浏览器会打开）：" -ForegroundColor Yellow
  gh auth login --web --git-protocol https
}

# 2) 提交本地改动
git add -A
$changes = git status --porcelain
if ($changes) {
  $msg = "update: " + (Get-Date -Format "yyyy-MM-dd HH:mm")
  git commit -m $msg | Out-Null
  Write-Host "已提交：$msg" -ForegroundColor Green
} else {
  Write-Host "没有文件改动" -ForegroundColor DarkGray
}

# 3) 远端不存在就创建并推送，存在就普通推送
$remote = git remote 2>$null
if (-not $remote) {
  Write-Host "远端仓库不存在，正在创建 block-miner ..." -ForegroundColor Yellow
  gh repo create block-miner --public --source=. --remote=origin --push
} else {
  git push
}

Write-Host ""
Write-Host "完成。仓库地址：" -ForegroundColor Green
gh repo view --json url -q .url

Read-Host "按回车关闭"
