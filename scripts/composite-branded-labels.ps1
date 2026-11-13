Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$source = Join-Path $root 'public/images/product-mockups/full-photo-v3-source'
$generated = Join-Path $root 'public/images/product-mockups/generated'

Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Imaging;

public static class ProductLabelComposite {
    public static void Make(string sourcePath, string editPath, string outputPath, int[] boxes, int feather) {
        using (var original = new Bitmap(sourcePath))
        using (var edited = new Bitmap(editPath))
        using (var result = new Bitmap(original.Width, original.Height, PixelFormat.Format32bppArgb)) {
            if (original.Width != edited.Width || original.Height != edited.Height)
                throw new Exception("Source and edited dimensions differ: " + editPath);
            using (var graphics = Graphics.FromImage(result)) graphics.DrawImageUnscaled(original, 0, 0);
            for (int i = 0; i < boxes.Length; i += 4) {
                int left = boxes[i], top = boxes[i + 1], right = boxes[i + 2], bottom = boxes[i + 3];
                for (int y = top; y < bottom; y++) {
                    for (int x = left; x < right; x++) {
                        double edge = Math.Min(Math.Min(x - left, right - 1 - x), Math.Min(y - top, bottom - 1 - y));
                        double alpha = Math.Min(1.0, Math.Max(0.0, edge / feather));
                        if (alpha <= 0) continue;
                        Color a = result.GetPixel(x, y);
                        Color b = edited.GetPixel(x, y);
                        int red = (int)Math.Round(a.R * (1 - alpha) + b.R * alpha);
                        int green = (int)Math.Round(a.G * (1 - alpha) + b.G * alpha);
                        int blue = (int)Math.Round(a.B * (1 - alpha) + b.B * alpha);
                        result.SetPixel(x, y, Color.FromArgb(red, green, blue));
                    }
                }
            }
            result.Save(outputPath, ImageFormat.Png);
        }
    }
}
'@

$items = @(
    @{ sku = '2S10'; base = '2S10'; edit = '2S10-HP-31'; box = @(365, 680, 725, 880) },
    @{ sku = '2S50'; base = '2S50'; edit = '2S50-HP-31'; box = @(365, 680, 725, 880) },
    @{ sku = 'RT15'; base = 'RT15'; edit = 'RT15-branded'; box = @(365, 670, 725, 940) },
    @{ sku = 'RT20'; base = 'RT20'; edit = 'RT20-branded'; box = @(365, 670, 725, 940) },
    @{ sku = 'RT30'; base = 'RT30'; edit = 'RT30-branded'; box = @(365, 670, 725, 940) },
    @{ sku = 'TR20'; base = 'TR20'; edit = 'TR20-branded'; box = @(365, 670, 725, 940) },
    @{ sku = 'TR30'; base = 'TR30'; edit = 'TR30-branded'; box = @(365, 670, 725, 940) },
    @{ sku = 'TR40'; base = 'TR40'; edit = 'TR40-branded'; box = @(365, 670, 725, 940) },
    @{ sku = 'TSM10'; base = 'TSM10'; edit = 'TSM10-branded'; box = @(365, 670, 725, 940) },
    @{ sku = 'TSM20'; base = 'TSM20'; edit = 'TSM20-branded'; box = @(365, 670, 725, 940) },
    @{ sku = 'WA10'; base = 'WA10'; edit = 'WA10-sterile-bacteriostatic'; box = @(365, 650, 745, 970, 275, 900, 425, 1015) },
    @{ sku = 'WA30'; base = 'WA10'; edit = 'WA30-sterile-bacteriostatic'; box = @(365, 650, 745, 970, 275, 900, 425, 1015) },
    @{ sku = 'WA50'; base = 'WA10'; edit = 'WA50-sterile-bacteriostatic'; box = @(365, 650, 745, 970, 275, 900, 425, 1015) },
    @{ sku = 'WA100'; base = 'WA10'; edit = 'WA100-sterile-bacteriostatic'; box = @(365, 650, 745, 970, 275, 900, 425, 1015) }
)

foreach ($item in $items) {
    $basePath = Join-Path $source "$($item.base).png"
    $editPath = Join-Path $generated "$($item.edit).png"
    $outputPath = Join-Path $generated "$($item.edit)-clean.png"
    [ProductLabelComposite]::Make($basePath, $editPath, $outputPath, $item.box, 16)
    Write-Output $outputPath
}
