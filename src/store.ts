import { constants } from "node:fs";
import { mkdir, open, readdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Plan } from "./types.js";

export interface LoadError {
  planId: string;
  reason: string;
}

export interface LoadAllPlansResult {
  plans: Plan[];
  errors: LoadError[];
}

const LOCK_STALE_MS = 10_000;
const LOCK_RETRY_MS = 50;
const LOCK_MAX_RETRIES = 100;

function planPath(dir: string, planId: string): string {
  return join(dir, `${planId}.json`);
}

function lockPath(dir: string, planId: string): string {
  return join(dir, `${planId}.json.lock`);
}

async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}

/** Acquire a lockfile. Retries on contention, removes stale locks. */
async function acquireLock(dir: string, planId: string): Promise<void> {
  const path = lockPath(dir, planId);
  for (let attempt = 0; attempt < LOCK_MAX_RETRIES; attempt++) {
    try {
      const fh = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL);
      await fh.close();
      return;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;

      // Check for stale lock
      try {
        const st = await stat(path);
        if (Date.now() - st.mtimeMs > LOCK_STALE_MS) {
          await unlink(path).catch(() => {});
          continue;
        }
      } catch {
        // Lock disappeared between our open and stat — retry
        continue;
      }

      await sleep(LOCK_RETRY_MS);
    }
  }
  throw new Error(`Failed to acquire lock for plan ${planId} after ${LOCK_MAX_RETRIES} retries`);
}

async function releaseLock(dir: string, planId: string): Promise<void> {
  await unlink(lockPath(dir, planId)).catch(() => {});
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Read a plan from disk. Returns undefined if not found. */
export async function loadPlan(dir: string, planId: string): Promise<Plan | undefined> {
  try {
    const data = await readFile(planPath(dir, planId), "utf-8");
    return JSON.parse(data) as Plan;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
}

/** Load all plans from disk.
 * Returns `{ plans, errors }`. Per-plan failures (parse error, etc.) are
 * collected into `errors` rather than thrown, so a single bad file doesn't
 * block the rest. ENOENT on the directory itself is treated as "no plans yet"
 * and returns `{ plans: [], errors: [] }`.
 */
export async function loadAllPlans(dir: string): Promise<LoadAllPlansResult> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { plans: [], errors: [] };
    throw err;
  }

  const plans: Plan[] = [];
  const errors: LoadError[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".json") || entry.endsWith(".lock")) continue;
    const planId = entry.slice(0, -5);
    try {
      const plan = await loadPlan(dir, planId);
      if (plan) plans.push(plan);
    } catch (err: unknown) {
      errors.push({ planId, reason: (err as Error).message });
    }
  }
  return { plans, errors };
}

/** Write a new plan to disk. No locking needed — fresh ID means no contention. */
export async function savePlan(dir: string, plan: Plan): Promise<void> {
  await ensureDir(dir);
  const path = planPath(dir, plan.id);
  const tmp = `${path}.tmp.${process.pid}`;
  await writeFile(tmp, JSON.stringify(plan, null, 2), "utf-8");
  await rename(tmp, path);
}

/** Read-modify-write a plan under a lockfile. */
export async function withPlan(dir: string, planId: string, fn: (plan: Plan) => Plan): Promise<Plan> {
  await ensureDir(dir);
  await acquireLock(dir, planId);
  try {
    const plan = await loadPlan(dir, planId);
    if (!plan) throw new Error(`Plan ${planId} not found`);
    const updated = fn(plan);
    const path = planPath(dir, plan.id);
    const tmp = `${path}.tmp.${process.pid}`;
    await writeFile(tmp, JSON.stringify(updated, null, 2), "utf-8");
    await rename(tmp, path);
    return updated;
  } finally {
    await releaseLock(dir, planId);
  }
}

/** Delete a plan file from disk. */
export async function deletePlan(dir: string, planId: string): Promise<void> {
  await unlink(planPath(dir, planId)).catch(() => {});
}
