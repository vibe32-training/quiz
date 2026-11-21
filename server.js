// Local development server. On Vercel, public/ is served statically and api/ runs as functions.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import handler from "./api/generate.js";
import gradeHandler from "./api/grade.js";

const root = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(root, "public");
const MAX_BODY_BYTES = 256_000;
const API_ROUTES = { "/api/generate": handler, "/api/grade": gradeHandler };

function loadEnvFile(file) {
  const fullPath = path.join(root, file);
  if (!fs.existsSync(fullPath)) return;
  for (const line of fs.readFileSync(fullPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    process.env[match[1]] = match[2].trim().replace(/^(['"])(.*)\1$/, "$2");
  }
}

loadEnvFile(".env.local");
loadEnvFile("env_local.txt");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".pdf": "application/pdf",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon"
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function serveStatic(req, res, pathname) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { Allow: "GET, HEAD" }).end();
    return;
  }
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    res.writeHead(400).end();
    return;
  }
  const filePath = path.resolve(publicDir, "." + (decoded === "/" ? "/index.html" : decoded));
  if (!filePath.startsWith(publicDir + path.sep)) {
    res.writeHead(404).end();
    return;
  }
  fs.readFile(filePath, (error, content) => {
    if (error) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not found");
      return;
    }
    res.writeHead(200, { "Content-Type": MIME_TYPES[path.extname(filePath)] || "application/octet-stream" });
    res.end(req.method === "HEAD" ? undefined : content);
  });
}

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, "http://localhost");
  const apiHandler = Object.hasOwn(API_ROUTES, pathname) ? API_ROUTES[pathname] : null;
  if (!apiHandler) return serveStatic(req, res, pathname);

  if (req.method === "POST") {
    try {
      req.body = await readBody(req);
    } catch {
      res.writeHead(413, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "요청 본문이 너무 큽니다." }));
      return;
    }
  }
  await apiHandler(req, res);
});

const port = Number(process.env.PORT) || 3000;
server.listen(port, "127.0.0.1", () => {
  console.log(`Quiz app running at http://localhost:${port}`);
});
