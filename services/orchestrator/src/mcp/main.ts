// stdio entry for the NEXUS agent tools. Started once per agent by docker-agent (agents/nexus.yaml).
// stdout carries the MCP protocol, so nothing else may write to it.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { DataStore } from "./dataStore.js";
import { buildNexusToolServer } from "./nexusTools.js";
import { TeamBoard } from "./teamBoard.js";

const root = path.resolve(process.env.NEXUS_ROOT ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "../../../.."));
const runDir = path.resolve(process.env.NEXUS_RUN_DIR ?? path.join(root, ".nexus-run"));

const server = buildNexusToolServer(new DataStore({ root, runDir }), new TeamBoard(runDir));
server.connect(new StdioServerTransport()).catch((err: unknown) => {
  process.stderr.write(`nexus-tools failed to start: ${String(err)}\n`);
  process.exit(1);
});
