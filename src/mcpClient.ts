import { log } from "./logger.js";

export interface McpTool {
  name: string;
  description: string;
  parameters: any;
  output_schema: any;
  annotations: any;
  access: "read" | "write" | "delete";
}

const MCP_URL = process.env.MCP_URL || "http://localhost:3001";
let isInitialized = false;

const fetchTools = async () => {
  const response = await fetch(`${MCP_URL}/tools`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    });
    return response
}

/**
 * Initialize the MCP client connection. Should be called once at startup.
 */
export async function initializeMcpClient(): Promise<void> {
  if (isInitialized) {
    log.warn("⚠️  MCP client already initialized");
    return;
  }

  log.info(`🔌 Connecting to Plex MCP server at ${MCP_URL}...`);

  // Test connection by listing tools
  try {
    const response = await fetchTools();

    if (response.ok) {
      isInitialized = true;
      log.info("✅ Connected to Plex MCP server");
    } else {
      const text = await response.text();
      throw new Error(`Connection failed: HTTP ${response.status} - ${text}`);
    }
  } catch (error) {
    log.error("Failed to connect to MCP server:", error as Error);
    throw error;
  }
}

function ensureInitialized(): void {
  if (!isInitialized) {
    throw new Error("MCP client not initialized. Call initializeMcpClient() first.");
  }
}

export async function listTools(): Promise<McpTool[]> {
  ensureInitialized();
  log.debug("📋 Fetching tools from MCP server...");

  const httpResponse = await fetchTools();

  if (!httpResponse.ok) {
    throw new Error(`HTTP ${httpResponse.status}: ${await httpResponse.text()}`);
  }

  const tools: McpTool[] = await httpResponse.json() as McpTool[];

  log.info(`📋 Found ${tools.length} tools`);
  log.debug(`  - Read-only: ${tools.filter(t => t.access === "read").length}`);
  log.debug(`  - Write/Modify: ${tools.filter(t => t.access === "write").length}`);
  return tools;
}

export async function callTool(name: string, args: Record<string, any>): Promise<any> {
  ensureInitialized();

  log.info(`🔧 Calling tool: ${name}`, { args });

  const httpResponse = await fetch(`${MCP_URL}/tools/call`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: JSON.stringify({
      tool: name,
      arguments: args
    })
  });

  if (!httpResponse.ok) {
    throw new Error(`HTTP ${httpResponse.status}: ${await httpResponse.text()}`);
  }

  const response: any = await httpResponse.json();
  return response.result || response;
}

// Cleanup function
export async function disconnect(): Promise<void> {
  isInitialized = false;
  log.info("🔌 Disconnected from Plex MCP server");
}
