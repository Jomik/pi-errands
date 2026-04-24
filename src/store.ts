import { constants } from "node:fs";
import { mkdir, open, readdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Plan } from "./types.js";

const ERRANDS_DIR = ".pi/errands";
const LOCK_STALE_MS = 10_000;
const LOCK_RETRY_MS = 50;
const LOCK_MAX_RETRIES = 100;

function planPath(cwd: string, planId: string): string {
  return join(cwd, ERRANDS_DIR, `${planId}.json`);
}

function lockPath(cwd: string, planId: string): string {
  return join(cwd, ERRANDS_DIR, `${planId}.json.lock`);
}

async function ensureDir(cwd: string): Promise<void> {
  await mkdir(join(cwd, ERRANDS_DIR), { recursive: true });
}

/** Acquire a lockfile. Retries on contention, removes stale locks. */
async function acquireLock(cwd: string, planId: string): Promise<void> {
  const path = lockPath(cwd, planId);
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

async function releaseLock(cwd: string, planId: string): Promise<void> {
  await unlink(lockPath(cwd, planId)).catch(() => {});
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Read a plan from disk. Returns undefined if not found. */
export async function loadPlan(cwd: string, planId: string): Promise<Plan | undefined> {
  try {
    const data = await readFile(planPath(cwd, planId), "utf-8");
    return JSON.parse(data) as Plan;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
}

/** Load all plans from disk. */
export async function loadAllPlans(cwd: string): Promise<Plan[]> {
  const dir = join(cwd, ERRANDS_DIR);
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }

  const plans: Plan[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".json") || entry.endsWith(".lock")) continue;
    const planId = entry.slice(0, -5);
    const plan = await loadPlan(cwd, planId);
    if (plan) plans.push(plan);
  }
  return plans;
}

/** Write a new plan to disk. No locking needed — fresh ID means no contention. */
export async function savePlan(cwd: string, plan: Plan): Promise<void> {
  await ensureDir(cwd);
  const path = planPath(cwd, plan.id);
  const tmp = `${path}.tmp.${process.pid}`;
  await writeFile(tmp, JSON.stringify(plan, null, 2), "utf-8");
  await rename(tmp, path);
}

/** Read-modify-write a plan under a lockfile. */
export async function withPlan(cwd: string, planId: string, fn: (plan: Plan) => Plan): Promise<Plan> {
  await ensureDir(cwd);
  await acquireLock(cwd, planId);
  try {
    const plan = await loadPlan(cwd, planId);
    if (!plan) throw new Error(`Plan ${planId} not found`);
    const updated = fn(plan);
    const path = planPath(cwd, plan.id);
    const tmp = `${path}.tmp.${process.pid}`;
    await writeFile(tmp, JSON.stringify(updated, null, 2), "utf-8");
    await rename(tmp, path);
    return updated;
  } finally {
    await releaseLock(cwd, planId);
  }
}

/** Delete a plan file from disk. */
export async function deletePlan(cwd: string, planId: string): Promise<void> {
  await unlink(planPath(cwd, planId)).catch(() => {});
}
