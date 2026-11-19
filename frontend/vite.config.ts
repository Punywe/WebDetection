import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import fs from 'node:fs';
import path from 'node:path';

function ortWasmPlugin(): Plugin {
  const distDir = path.resolve('node_modules/onnxruntime-web/dist');

  return {
    name: 'vite-plugin-ort-wasm',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url || '').split('?')[0];
        if (url.startsWith('/ort-dist/')) {
          const fileName = path.basename(url);
          const filePath = path.join(distDir, fileName);
          if (fs.existsSync(filePath)) {
            if (fileName.endsWith('.wasm')) {
              res.setHeader('Content-Type', 'application/wasm');
            } else if (fileName.endsWith('.mjs') || fileName.endsWith('.js')) {
              res.setHeader('Content-Type', 'application/javascript');
            }
            res.setHeader('Access-Control-Allow-Origin', '*');
            return fs.createReadStream(filePath).pipe(res);
          }
        }
        next();
      });
    },
    closeBundle() {
      const outDir = path.resolve('dist/ort-dist');
      if (!fs.existsSync(outDir)) {
        fs.mkdirSync(outDir, { recursive: true });
      }
      if (fs.existsSync(distDir)) {
        const files = fs.readdirSync(distDir);
        for (const file of files) {
          if (file.endsWith('.wasm') || file.endsWith('.mjs')) {
            fs.copyFileSync(path.join(distDir, file), path.join(outDir, file));
          }
        }
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), ortWasmPlugin()],
  optimizeDeps: {
    exclude: ['onnxruntime-web'],
  },
});
