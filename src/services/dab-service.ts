import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import type { PluginContext } from "../lib/types.js";
import { getSecret } from "../lib/secret-store.js";

export interface DabServiceState {
  running: boolean;
  pid?: number;
  port: number;
  healthy: boolean;
  startedAt?: string;
  lastError?: string;
}

let instance: DabService | null = null;

export function createDabService(ctx: PluginContext): DabService {
  instance = new DabService(ctx);
  return instance;
}

export function getDabService(): DabService | null {
  return instance;
}

export class DabService {
  private process: ChildProcess | null = null;
  private ctx: PluginContext;
  private _state: DabServiceState;

  constructor(ctx: PluginContext) {
    this.ctx = ctx;
    this._state = {
      running: false,
      port: ctx.config.dabPort ?? 5000,
      healthy: false,
    };
  }

  get state(): Readonly<DabServiceState> {
    return { ...this._state };
  }

  async start(opts?: { projectDir?: string; port?: number }): Promise<DabServiceState> {
    if (this.process && this._state.running) {
      this.ctx.logger.info("DAB service already running, pid:", this._state.pid);
      return this.state;
    }

    const projectDir = opts?.projectDir || this.ctx.config.projectDir || process.cwd();
    const port = opts?.port || this.ctx.config.dabPort || 5000;
    const configPath = path.join(projectDir, "dab-config.json");

    if (!fs.existsSync(configPath)) {
      const err = `dab-config.json not found at ${configPath}`;
      this._state.lastError = err;
      throw new Error(err);
    }

    // Get connection string from secret store
    const connString = getSecret("SQL_CONN");
    if (!connString) {
      const err = "No SQL_CONN found in secret store. Provision a database first or store the connection string.";
      this._state.lastError = err;
      throw new Error(err);
    }

    const env = {
      ...process.env,
      SQL_CONN: connString,
    };

    this._state.port = port;

    this.ctx.logger.info(`Starting DAB on port ${port} in ${projectDir}...`);

    this.process = spawn("dab", ["start", "--config", "dab-config.json"], {
      cwd: projectDir,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: false,
    });

    this._state.running = true;
    this._state.pid = this.process.pid;
    this._state.startedAt = new Date().toISOString();
    this._state.lastError = undefined;

    this.process.stdout?.on("data", (data: Buffer) => {
      this.ctx.logger.debug("[DAB stdout]", data.toString().trim());
    });

    this.process.stderr?.on("data", (data: Buffer) => {
      this.ctx.logger.debug("[DAB stderr]", data.toString().trim());
    });

    this.process.on("error", (err) => {
      this.ctx.logger.error("DAB process error:", err.message);
      this._state.running = false;
      this._state.healthy = false;
      this._state.lastError = err.message;
      this.process = null;
    });

    this.process.on("exit", (code, signal) => {
      this.ctx.logger.info(`DAB process exited (code=${code}, signal=${signal})`);
      this._state.running = false;
      this._state.healthy = false;
      if (code !== 0 && code !== null) {
        this._state.lastError = `Process exited with code ${code}`;
      }
      this.process = null;
    });

    // Wait briefly and check health
    await this.waitForHealth(port, 10_000);

    return this.state;
  }

  async stop(): Promise<DabServiceState> {
    if (!this.process) {
      this.ctx.logger.info("DAB service not running, nothing to stop.");
      this._state.running = false;
      this._state.healthy = false;
      return this.state;
    }

    this.ctx.logger.info("Stopping DAB service, pid:", this._state.pid);

    return new Promise<DabServiceState>((resolve) => {
      const timeout = setTimeout(() => {
        // Force kill if SIGTERM didn't work
        if (this.process) {
          this.ctx.logger.warn("DAB did not exit gracefully, sending SIGKILL");
          this.process.kill("SIGKILL");
        }
      }, 5_000);

      this.process!.on("exit", () => {
        clearTimeout(timeout);
        this._state.running = false;
        this._state.healthy = false;
        this._state.pid = undefined;
        this.process = null;
        resolve(this.state);
      });

      this.process!.kill("SIGTERM");
    });
  }

  async checkHealth(): Promise<boolean> {
    try {
      const resp = await fetch(`http://localhost:${this._state.port}/health`);
      this._state.healthy = resp.ok;
      return resp.ok;
    } catch {
      this._state.healthy = false;
      return false;
    }
  }

  private async waitForHealth(port: number, timeoutMs: number): Promise<void> {
    const start = Date.now();
    const interval = 500;

    while (Date.now() - start < timeoutMs) {
      try {
        const resp = await fetch(`http://localhost:${port}/health`);
        if (resp.ok) {
          this._state.healthy = true;
          this.ctx.logger.info("DAB is healthy on port", port);
          return;
        }
      } catch {
        // Not ready yet
      }
      await new Promise((r) => setTimeout(r, interval));
    }

    this.ctx.logger.warn(`DAB health check timed out after ${timeoutMs}ms — process may still be starting`);
  }
}
