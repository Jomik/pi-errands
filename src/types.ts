export type Status = "pending" | "active" | "done" | "failed" | "skipped";

export const TERMINAL_STATUSES: ReadonlySet<Status> = new Set(["done", "failed", "skipped"]);

export interface Chore {
  id: string;
  text: string;
  status: Status;
}

export interface Errand {
  id: string;
  text: string;
  chores: Chore[];
}

export interface Plan {
  id: string;
  name: string;
  errands: Errand[];
  createdAt: number;
}

/** Persisted via appendEntry to track what this session is following. */
export interface TrackingEntry {
  /** Plan or errand ID. */
  id: string;
  untrack?: boolean;
}
