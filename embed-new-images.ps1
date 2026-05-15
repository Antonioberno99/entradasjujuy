$htmlPath  = "c:\Users\anton\OneDrive\Documentos\entradasjujuy\entradasjujuy-v7-2.html"
$imgDir    = "c:\Users\anton\OneDrive\Documentos\entradasjujuy\img"
$brain     = "C:\Users\anton\.gemini\antigravity\brain\84a4de6c-4349-4ed0-add3-bb91d7c9ba03"

# --- 1. Borrar y recrear carpeta img ---
if (Test-Path $imgDir) {
    Remove-Item $imgDir -Recurse -Force
    Write-Host "Carpeta img borrada."
}
New-Item -ItemType Directory -Path $imgDir | Out-Null
Write-Host "Carpeta img creada."

# --- 2. Copiar las 4 fotos con nombres finales ---
$photos = @(
    @{ src = "media__1777485868975.png"; dest = "hero-1.png";  type = "png"  },  # cantante b&w
    @{ src = "media__1777485869086.jpg"; dest = "hero-2.jpg";  type = "jpeg" },  # DJ fiesta
    @{ src = "media__1777485869333.jpg"; dest = "hero-3.jpg";  type = "jpeg" },  # guitarrista
    @{ src = "media__1777485869334.png"; dest = "hero-4.png";  type = "png"  }   # mujer caja
)

foreach ($p in $photos) {
    $src  = Join-Path $brain $p.src
    $dest = Join-Path $imgDir $p.dest
    Copy-Item $src $dest
    Write-Host "Copiado: $($p.dest)"
}

# --- 3. Embedder como base64 en el HTML ---
Write-Host "Leyendo HTML..."
$html = [System.IO.File]::ReadAllText($htmlPath, [System.Text.Encoding]::UTF8)

$slotMap = @(
    @{ id = "ejs-0"; file = "hero-1.png";  type = "png"  },
    @{ id = "ejs-1"; file = "hero-2.jpg";  type = "jpeg" },
    @{ id = "ejs-2"; file = "hero-3.jpg";  type = "jpeg" },
    @{ id = "ejs-3"; file = "hero-4.png";  type = "png"  }
)

foreach ($slot in $slotMap) {
    $imgPath = Join-Path $imgDir $slot.file
    Write-Host "Procesando $($slot.id): $($slot.file)..."
    $bytes   = [System.IO.File]::ReadAllBytes($imgPath)
    $b64     = [System.Convert]::ToBase64String($bytes)
    $newSrc  = "data:image/$($slot.type);base64,$b64"

    # Reemplazar src existente (ya sea ruta relativa O data URI vieja)
    $pattern = '(id="' + $slot.id + '"[^>]*?src=")[^"]*(")'
    $html = [System.Text.RegularExpressions.Regex]::Replace(
        $html,
        $pattern,
        '$1' + $newSrc + '$2',
        [System.Text.RegularExpressions.RegexOptions]::Singleline
    )
    Write-Host "OK."
}

Write-Host "Escribiendo HTML..."
[System.IO.File]::WriteAllText($htmlPath, $html, [System.Text.Encoding]::UTF8)
$mb = [Math]::Round((Get-Item $htmlPath).Length / 1MB, 1)
Write-Host "Listo. Tamano final: $mb MB"
Write-Host "Las imagenes estan embedidas directamente en el HTML."
