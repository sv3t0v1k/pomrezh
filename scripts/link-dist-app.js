/**
 * Создаёт в dist/ симлинк ПомРеж.app на каталог dist/mac-arm64 (или mac-x64) после сборки.
 */
const fs = require('fs');
const path = require('path');

const dist = path.join(__dirname, '..', 'dist');
const linkName = path.join(dist, 'ПомРеж.app');

const candidates = ['mac-arm64', 'mac-x64', 'mac'].map((d) => path.join(dist, d, 'ПомРеж.app'));
const src = candidates.find((p) => fs.existsSync(p));
if (!src) {
    console.warn('link-dist-app: не найден собранный .app в dist/mac-*');
    process.exit(0);
}

const rel = path.relative(dist, src);
try {
    if (fs.existsSync(linkName) || fs.lstatSync(linkName, { throwIfNoEntry: false })) {
        try {
            fs.unlinkSync(linkName);
        } catch {
            fs.rmSync(linkName, { recursive: true, force: true });
        }
    }
} catch {
    /* ignore */
}

fs.symlinkSync(rel, linkName, 'dir');
console.log('link-dist-app:', linkName, '→', rel);
