import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const siteRoot = resolve(fileURLToPath(new URL("./dist/", import.meta.url)));
const host = "127.0.0.1";
const port = Number(process.env.PORT) || 4173;

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mp3": "audio/mpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".wav": "audio/wav",
  ".webp": "image/webp",
};

function send(response, status, body, type = "text/plain; charset=utf-8") {
  response.writeHead(status, { "Content-Type": type, "Cache-Control": "no-cache" });
  response.end(body);
}

const server = createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url || "/", `http://${request.headers.host || host}`);
    let pathname = decodeURIComponent(requestUrl.pathname);
    if (pathname.endsWith("/")) pathname += "index.html";

    let filePath = resolve(siteRoot, `.${pathname}`);
    if (filePath !== siteRoot && !filePath.startsWith(`${siteRoot}${sep}`)) {
      send(response, 403, "Forbidden");
      return;
    }

    const fileStats = await stat(filePath);
    if (fileStats.isDirectory()) filePath = resolve(filePath, "index.html");
    const file = await readFile(filePath);
    send(response, 200, file, contentTypes[extname(filePath).toLowerCase()] || "application/octet-stream");
  } catch (error) {
    if (error?.code === "ENOENT") {
      try {
        const notFound = await readFile(resolve(siteRoot, "404.html"));
        send(response, 404, notFound, contentTypes[".html"]);
      } catch {
        send(response, 404, "Not found");
      }
      return;
    }
    console.error(error);
    send(response, 500, "The local server could not load this file.");
  }
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") console.error(`Port ${port} is already in use. Close the other local server and press Run again.`);
  else console.error(error);
  process.exitCode = 1;
});

server.listen(port, host, () => {
  console.log(`Sirius Entertainment running at http://${host}:${port}/`);
});
