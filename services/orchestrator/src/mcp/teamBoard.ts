import { appendFile, mkdir, readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { evidenceCandidate, teamNote, type EvidenceCandidate, type TeamNote } from "@nexus/schemas";

/**
 * Append-only JSONL files in the run directory. Each agent runs its own MCP server process,
 * so the file is what lets agents in one run see each other's notes.
 */
export class TeamBoard {
  constructor(private readonly runDir: string) {}

  private get notesFile() {
    return path.join(this.runDir, "team-board.jsonl");
  }

  private get candidatesFile() {
    return path.join(this.runDir, "evidence-candidates.jsonl");
  }

  async post(note: Omit<TeamNote, "id" | "createdAt">): Promise<TeamNote> {
    const full = teamNote.parse({ ...note, id: `NOTE-${randomUUID()}`, createdAt: new Date().toISOString() });
    await this.append(this.notesFile, full);
    return full;
  }

  async read(filter: { runId: string; forAgentId?: string; sinceId?: string }): Promise<TeamNote[]> {
    const notes = (await readLines(this.notesFile)).flatMap((l) => {
      const parsed = teamNote.safeParse(l);
      return parsed.success && parsed.data.runId === filter.runId ? [parsed.data] : [];
    });
    const start = filter.sinceId ? notes.findIndex((n) => n.id === filter.sinceId) + 1 : 0;
    return notes
      .slice(start)
      .filter((n) => !filter.forAgentId || !n.toAgentId || n.toAgentId === filter.forAgentId || n.agentId === filter.forAgentId);
  }

  async propose(candidate: Omit<EvidenceCandidate, "id" | "createdAt" | "status">): Promise<EvidenceCandidate> {
    const full = evidenceCandidate.parse({
      ...candidate,
      id: `CAND-${randomUUID()}`,
      status: "pending_curation",
      createdAt: new Date().toISOString(),
    });
    await this.append(this.candidatesFile, full);
    return full;
  }

  private async append(file: string, value: unknown) {
    await mkdir(this.runDir, { recursive: true });
    await appendFile(file, JSON.stringify(value) + "\n", "utf8");
  }
}

async function readLines(file: string): Promise<unknown[]> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch {
    return [];
  }
  return text.split("\n").flatMap((line) => {
    if (!line.trim()) return [];
    try {
      return [JSON.parse(line) as unknown];
    } catch {
      return [];
    }
  });
}
