import { spawn } from "node:child_process";
import { networkInterfaces } from "node:os";
import { join } from "node:path";

function isPrivate(address) {
  const parts = address.split(".").map(Number);
  return parts.length === 4 && (parts[0] === 10 ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168));
}

const available = Object.values(networkInterfaces()).flatMap((entries) => entries ?? [])
  .filter((entry) => entry.family === "IPv4" && !entry.internal && isPrivate(entry.address));
const host = process.env.TREINO_LAN_HOST ?? available[0]?.address;
if (!host || !isPrivate(host)) {
  console.error("No private LAN IPv4 address was found. Set TREINO_LAN_HOST to your Wi-Fi IPv4 address.");
  process.exit(1);
}

const nextBin = join(process.cwd(), "node_modules", "next", "dist", "bin", "next");
const child = spawn(process.execPath, [nextBin, "dev", "--hostname", "0.0.0.0", "--port", "3000"], {
  stdio: "inherit", env: { ...process.env, TREINO_LAN_HOST: host },
});
console.log(`Phone/app URL: http://${host}:3000`);
child.on("exit", (code) => { process.exitCode = code ?? 1; });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
