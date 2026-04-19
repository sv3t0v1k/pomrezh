/**
 * Генерирует build/icon.png (512×512), если файла ещё нет.
 * Нужен пакет pngjs (devDependency).
 */
const fs = require('fs');
const path = require('path');

const out = path.join(__dirname, '..', 'build', 'icon.png');

if (fs.existsSync(out)) {
    process.exit(0);
}

let PNG;
try {
    PNG = require('pngjs').PNG;
} catch {
    console.warn('create-default-icon: pngjs не установлен, пропускаю генерацию icon.png');
    process.exit(0);
}

fs.mkdirSync(path.dirname(out), { recursive: true });

const w = 512;
const h = 512;
const png = new PNG({ width: w, height: h });

for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
        const i = (w * y + x) * 4;
        const cx = x - w / 2;
        const cy = y - h / 2;
        const r = Math.sqrt(cx * cx + cy * cy);
        const edge = 1 - Math.min(1, Math.abs(r - w * 0.38) / 40);
        const v = Math.floor(26 + edge * 40);
        png.data[i] = v;
        png.data[i + 1] = Math.floor(v * 0.95);
        png.data[i + 2] = Math.floor(v * 0.9);
        png.data[i + 3] = 255;
    }
}

png
    .pack()
    .pipe(fs.createWriteStream(out))
    .on('finish', () => {
        console.log('create-default-icon:', out);
    });
