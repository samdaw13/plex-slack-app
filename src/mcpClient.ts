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
    console.log("⚠️  MCP client already initialized");
    return;
  }

  console.log(`🔌 Connecting to Plex MCP server at ${MCP_URL}...`);

  // Test connection by listing tools
  try {
    const response = await fetchTools();

    if (response.ok) {
      isInitialized = true;
      console.log("✅ Connected to Plex MCP server");
    } else {
      const text = await response.text();
      throw new Error(`Connection failed: HTTP ${response.status} - ${text}`);
    }
  } catch (error) {
    console.error("Failed to connect to MCP server:", error);
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
  console.log("📋 Fetching tools from MCP server...");

  const httpResponse = await fetchTools();

  if (!httpResponse.ok) {
    throw new Error(`HTTP ${httpResponse.status}: ${await httpResponse.text()}`);
  }

  const tools: McpTool[] = await httpResponse.json() as McpTool[];

  console.log(`📋 Found ${tools.length} tools`);
  console.log(`  - Read-only: ${tools.filter(t => t.access === "read").length}`);
  console.log(`  - Write/Modify: ${tools.filter(t => t.access === "write").length}`);
  return tools;
}

export async function callTool(name: string, args: Record<string, any>): Promise<any> {
  ensureInitialized();

  console.log(`🔧 Calling tool: ${name}`);
  console.log(`📥 Args:`, JSON.stringify(args, null, 2));

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
  console.log("🔌 Disconnected from Plex MCP server");
}
