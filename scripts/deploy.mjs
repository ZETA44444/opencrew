// Builds the app and publishes dist/ to the gh-pages branch (GitHub Pages).
import { execSync } from 'node:child_process';
import fs from 'node:fs';

const run = (cmd, cwd) => execSync(cmd, { stdio: 'inherit', cwd });
const remote = execSync('git remote get-url origin').toString().trim();

run('npx vite build');
fs.writeFileSync('dist/.nojekyll', '');
// The browser extension, ready to download from the app (Apps conectadas → Tu navegador).
run('zip -qr ../dist/opencrew-extension.zip .', 'extension');
run('zip -qr ../dist/opencrew-escritorio.zip app.mjs page.mjs instalar.command desinstalar.command LEEME.txt', 'desktop');
fs.rmSync('dist/.git', { recursive: true, force: true });
run('git init -q -b gh-pages', 'dist');
run('git add -A', 'dist');
run('git -c user.name="OpenCrew deploy" -c user.email="opencrew@users.noreply.github.com" commit -q -m "Deploy"', 'dist');
run(`git push -f -q "${remote}" gh-pages`, 'dist');
fs.rmSync('dist/.git', { recursive: true, force: true });
console.log('✓ Publicado en GitHub Pages (tarda ~1 minuto en actualizarse)');
