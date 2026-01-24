# Test balloon notification
[void] [System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms')

$balloon = New-Object System.Windows.Forms.NotifyIcon
$balloon.Icon = [System.Drawing.SystemIcons]::Information
$balloon.BalloonTipIcon = 'Info'
$balloon.BalloonTipTitle = 'Auto-Resume Test'
$balloon.BalloonTipText = 'If you see this, notifications work!'
$balloon.Visible = $true
$balloon.ShowBalloonTip(10000)

Write-Host "Balloon notification shown - check system tray area"
Start-Sleep -Seconds 3
$balloon.Dispose()
