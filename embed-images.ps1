$htmlPath = "c:\Users\anton\OneDrive\Documentos\entradasjujuy\entradasjujuy-v7-2.html"
$imgDir   = "c:\Users\anton\OneDrive\Documentos\entradasjujuy\img\"

Write-Host "Leyendo HTML..."
$html = [System.IO.File]::ReadAllText($htmlPath, [System.Text.Encoding]::UTF8)

$images = @("hero-slider-1.png","hero-slider-2.png","hero-slider-3.png","hero-slider-4.png")

foreach ($img in $images) {
    $imgPath = Join-Path $imgDir $img
    $kb = [Math]::Round((Get-Item $imgPath).Length / 1024)
    Write-Host "Procesando: $img ($kb KB)"
    $bytes   = [System.IO.File]::ReadAllBytes($imgPath)
    $base64  = [System.Convert]::ToBase64String($bytes)
    $dataUri = "data:image/png;base64,$base64"
    $src_old = 'src="img/' + $img + '"'
    $src_new = 'src="' + $dataUri + '"'
    $html    = $html.Replace($src_old, $src_new)
}

Write-Host "Escribiendo HTML..."
[System.IO.File]::WriteAllText($htmlPath, $html, [System.Text.Encoding]::UTF8)
$mb = [Math]::Round((Get-Item $htmlPath).Length / 1MB, 1)
Write-Host "Listo. Tamano final: $mb MB"
