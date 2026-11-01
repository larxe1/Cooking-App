$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$rootDir = "d:\Cooking App"
$jpgPath = Join-Path $rootDir "Velina.jpg"
$icoPath = Join-Path $rootDir "src-launcher\velina.ico"
$favPath = Join-Path $rootDir "public\favicon.ico"
$pubJpgPath = Join-Path $rootDir "public\velina.jpg"

Copy-Item $jpgPath $pubJpgPath -Force

# Convert Velina.jpg to a crisp 256x256 square PNG-backed .ico file
$srcImg = [System.Drawing.Image]::FromFile($jpgPath)
$size = 256
$bmp = New-Object System.Drawing.Bitmap($size, $size)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality

$minDim = [Math]::Min($srcImg.Width, $srcImg.Height)
$srcX = [int](($srcImg.Width - $minDim) / 2)
$srcY = [int](($srcImg.Height - $minDim) / 2)
$destRect = New-Object System.Drawing.Rectangle(0, 0, $size, $size)
$srcRect = New-Object System.Drawing.Rectangle($srcX, $srcY, $minDim, $minDim)
$g.DrawImage($srcImg, $destRect, $srcRect, [System.Drawing.GraphicsUnit]::Pixel)
$g.Dispose()
$srcImg.Dispose()

$ms = New-Object System.IO.MemoryStream
$bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
$pngBytes = $ms.ToArray()
$ms.Dispose()
$bmp.Dispose()

function Write-IcoFile($targetPath, [byte[]]$pngData) {
  $fs = [System.IO.File]::Open($targetPath, [System.IO.FileMode]::Create)
  $bw = New-Object System.IO.BinaryWriter($fs)
  # ICONDIR header
  $bw.Write([UInt16]0)
  $bw.Write([UInt16]1)
  $bw.Write([UInt16]1)
  # ICONDIRENTRY (0 = 256x256)
  $bw.Write([byte]0)
  $bw.Write([byte]0)
  $bw.Write([byte]0)
  $bw.Write([byte]0)
  $bw.Write([UInt16]1)
  $bw.Write([UInt16]32)
  $bw.Write([UInt32]$pngData.Length)
  $bw.Write([UInt32]22)
  $bw.Write($pngData)
  $bw.Flush()
  $bw.Close()
  $fs.Close()
}

Write-IcoFile $icoPath $pngBytes
Write-IcoFile $favPath $pngBytes

$cscPath = "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
$exeOut = Join-Path $rootDir "CookBook.exe"
$csFile = Join-Path $rootDir "src-launcher\Launcher.cs"

& $cscPath /nologo /target:winexe /optimize+ "/out:$exeOut" "/win32icon:$icoPath" "$csFile"
Write-Host "Built CookBook.exe with Velina.jpg icon successfully."
