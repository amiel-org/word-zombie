import { spawn } from "node:child_process";
import http from "node:http";
import { resolve } from "node:path";

const executable = process.argv[2] ? resolve(process.argv[2]) : null;
if (!executable) throw new Error("Usage: node verify_windows_port_collision.mjs <exe>");

const port = 41739;
const dummyServer = http.createServer((request, response) => {
  if (request.url === "/manifest.webmanifest") {
    const body = JSON.stringify({ name: "Another Local App", short_name: "Other" });
    response.writeHead(200, { "Content-Type": "application/manifest+json" });
    response.end(body);
    return;
  }
  response.writeHead(200, { "Content-Type": "text/plain" });
  response.end("another local service");
});

await new Promise((resolveListen, rejectListen) => {
  dummyServer.once("error", rejectListen);
  dummyServer.listen(port, "127.0.0.1", resolveListen);
});

try {
  const child = spawn(executable, [], {
    env: { ...process.env, WORD_ZOMBIE_NO_BROWSER: "1" },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });

  const exitCode = await Promise.race([
    new Promise((resolveExit, rejectExit) => {
      child.once("error", rejectExit);
      child.once("close", resolveExit);
    }),
    new Promise((_, rejectTimeout) => {
      setTimeout(() => rejectTimeout(new Error("Collision test timed out")), 10_000);
    }),
  ]);

  if (exitCode !== 1) throw new Error(`Expected exit code 1, received ${exitCode}`);
  if (!stderr.includes("not Word Zombie")) {
    throw new Error(`Expected collision warning, received: ${stderr || stdout}`);
  }
  if (stdout.includes("already running")) {
    throw new Error("Launcher treated another local service as Word Zombie");
  }
  console.log(JSON.stringify({ exitCode, stdout: stdout.trim(), stderr: stderr.trim() }, null, 2));
} finally {
  await new Promise((resolveClose) => dummyServer.close(resolveClose));
}
