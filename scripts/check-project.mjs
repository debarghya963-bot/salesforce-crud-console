import fs from "node:fs";
import path from "node:path";
const required = [
  "package.json", ".env.example", "server/index.js",
  "client/index.html", "client/src/main.jsx", "client/src/styles.css", "render.yaml", "README.md"
];
for (const file of required) {
  if (!fs.existsSync(path.resolve(file))) throw new Error(`Missing ${file}`);
}
console.log("Project structure OK.");
