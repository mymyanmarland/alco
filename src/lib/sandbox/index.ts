/**
 * Sandbox driver selection (M5). Server-side only.
 *
 * SANDBOX_DRIVER=docker  → DockerDriver (production)
 * SANDBOX_DRIVER=local   → LocalDriver (DEV/TEST ONLY)
 * unset                  → local + a loud warning (never silent)
 */
import { DockerDriver } from "./docker-driver";
import { LocalDriver } from "./local-driver";
import type { SandboxDriver } from "./types";

export function getSandboxDriver(): SandboxDriver {
  const which = (process.env.SANDBOX_DRIVER ?? "").trim().toLowerCase();
  if (which === "docker") {
    return new DockerDriver();
  }
  if (which === "local" || which === "") {
    if (process.env.NODE_ENV === "production") {
      console.warn(
        "[sandbox] WARNING: using the LOCAL (dev-only) driver in production. " +
          "Untrusted code MUST NOT be executed here. Set SANDBOX_DRIVER=docker.",
      );
    } else if (which === "") {
      console.warn(
        "[sandbox] SANDBOX_DRIVER not set — defaulting to the local dev/test driver.",
      );
    }
    return new LocalDriver();
  }
  throw new Error(
    `Unknown SANDBOX_DRIVER=${JSON.stringify(which)} (expected "docker" or "local")`,
  );
}

export type { SandboxDriver };
export { RUN_LIMITS } from "./types";
export type {
  RunOptions,
  RunOutput,
  SandboxNetwork,
} from "./types";
