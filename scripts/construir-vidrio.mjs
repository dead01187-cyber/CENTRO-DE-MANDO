// Compila vidrio/fuente/vidrio.jsx → vidrio/vidrio.js (un solo archivo, sin React global, modo producción).
// Uso: npm run build:vidrio   (en una COPIA del repo: Chrome no carga la extensión si tiene node_modules)
// MODULOS=/otra/ruta/node_modules permite compilar con las dependencias instaladas fuera del repo.
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const modulos = process.env.MODULOS || path.join(raiz, "node_modules");
const { build } = createRequire(path.join(modulos, "_"))("esbuild"); // esbuild de donde estén instaladas las dependencias
await build({
  entryPoints: [path.join(raiz, "vidrio/fuente/vidrio.jsx")],
  outfile: path.join(raiz, "vidrio/vidrio.js"),
  bundle: true, minify: true, format: "iife", target: ["chrome120"], jsx: "automatic",
  nodePaths: [modulos], define: { "process.env.NODE_ENV": '"production"' }, legalComments: "none", logLevel: "warning",
  banner: { js: "/* Generado por scripts/construir-vidrio.mjs desde vidrio/fuente/vidrio.jsx — no editar a mano. Licencias: vidrio/LICENCIAS.txt */" },
});
// Licencias de lo que va adentro (MIT)
const lic = (p) => readFileSync(path.join(modulos, p), "utf8").trim();
writeFileSync(path.join(raiz, "vidrio/LICENCIAS.txt"), [
  "Este archivo (vidrio/vidrio.js) incluye código de terceros, todo con licencia MIT:\n",
  "== liquid-glass-react 1.1.1 ==", lic("liquid-glass-react/LICENSE"), "",
  "== react 19.1.0 ==", lic("react/LICENSE"), "",
  "== react-dom 19.1.0 ==", lic("react-dom/LICENSE"), "",
  "== scheduler ==", lic("scheduler/LICENSE"), "",
].join("\n"));
console.log("Listo: vidrio/vidrio.js y vidrio/LICENCIAS.txt");
