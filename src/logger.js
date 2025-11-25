import fs from "fs";
import path from "path";

const logDir = process.env.LOG_DIR || path.join(process.cwd(), "logs");
const logFile = path.join(logDir, "media-agent.log");

let stream = null;

function ensureStream() {
  if (process.env.NODE_ENV === "test") return null;
  if (!stream) {
    fs.mkdirSync(logDir, { recursive: true });
    stream = fs.createWriteStream(logFile, { flags: "a" });
  }
  return stream;
}

function write(level, message) {
  const ts = new Date().toISOString();
  const line = `[${ts}] [${level}] ${message}\n`;

  const s = ensureStream();
  if (s) s.write(line);

  // still echo to console outside of tests
  if (process.env.NODE_ENV !== "test") {
    if (level === "ERROR") console.error(line.trim());
    else console.log(line.trim());
  }
}

export function logInfo(msg) {
  write("INFO", msg);
}

export function logWarn(msg) {
  write("WARN", msg);
}

export function logError(msg) {
  write("ERROR", msg);
}
