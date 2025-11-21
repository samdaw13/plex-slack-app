import { listTools, McpTool, callTool } from "./mcpClient";
import OpenAI from "openai";
import dotenv from "dotenv";


dotenv.config();

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function getToolsByAccess(access: "read" | "write"): Promise<{
  name: string;
  description: string;
  parameters: any;
}[]> {
  const tools = await listTools();
  return tools
    .filter(t => t.access === access)
    .map(t => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters
    }));
}

// Simplify JSON schema by removing $defs and resolving references
function simplifySchema(schema: any): any {
  if (!schema || typeof schema !== 'object') {
    return schema;
  }

  // Create a clean copy
  const simplified: any = {};

  // Copy allowed fields, excluding problematic ones
  for (const [key, value] of Object.entries(schema)) {
    // Skip $defs, $schema, and other $ prefixed fields that cause issues
    if (key === '$defs' || key === '$schema' || key === '$ref') {
      continue;
    }

    // Recursively process nested objects and arrays
    if (key === 'properties' && typeof value === 'object' && value !== null) {
      simplified.properties = {};
      for (const [propKey, propValue] of Object.entries(value as Record<string, any>)) {
        const prop = propValue as any;

        // If property has $ref, replace with simple object type
        if (prop?.$ref) {
          simplified.properties[propKey] = {
            type: 'object',
            description: prop.description || `Reference to ${prop.$ref}`
          };
        } else {
          simplified.properties[propKey] = simplifySchema(prop);
        }
      }
    } else if (key === 'items' && typeof value === 'object') {
      // Handle array items
      const items = value as any;
      if (items.$ref) {
        simplified.items = { type: 'object' };
      } else {
        simplified.items = simplifySchema(items);
      }
    } else if (Array.isArray(value)) {
      simplified[key] = value.map(item =>
        typeof item === 'object' ? simplifySchema(item) : item
      );
    } else if (typeof value === 'object' && value !== null) {
      simplified[key] = simplifySchema(value);
    } else {
      simplified[key] = value;
    }
  }

  return simplified;
}

export async function runAgent(prompt: string, access: "read" | "write", userEmail?: string | null): Promise<string> {
  const toolDefs = await getToolsByAccess(access);

  const functions = toolDefs.map(tool => ({
    name: tool.name,
    description: tool.description,
    parameters: simplifySchema(tool.parameters)
  }));

  // Build system message with user context
  let systemMessage = `You are a Plex assistant. Only use ${access === "read" ? "read-only" : "write"} tools. When you use a tool, you must provide a natural language response based on the tool's results.`;

  if (userEmail) {
    console.log(`👤 User context: ${userEmail}`);
    systemMessage += `\n\nIMPORTANT: The user asking this question has the email address: ${userEmail}. When querying Plex data about "the user" or using user-specific tools, you should match this email with the appropriate Plex username from the user list. Use the user_search_users tool to find the matching Plex username for this email, then use that username for subsequent user-specific queries.`;
  } else {
    console.log(`👤 No user context available - will use server owner's data`);
  }

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: systemMessage },
    { role: "user", content: prompt }
  ];

  const MAX_ITERATIONS = 10;
  let iterations = 0;

  while (iterations < MAX_ITERATIONS) {
    iterations++;

    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages,
      functions,
      function_call: "auto"
    });

    const message = response.choices[0].message;

    console.log(`Iteration ${iterations}:`, message);

    // If there's no function call, we have a final answer
    if (!message.function_call) {
      return message.content || "";
    }

    // Execute the function call
    const { name, arguments: argsStr } = message.function_call;
    const args = JSON.parse(argsStr as string);
    const result = await callTool(name, args);

    console.log(`Tool ${name} result:`, result);

    // Add the assistant's function call to the conversation
    messages.push({
      role: "assistant",
      content: message.content,
      function_call: message.function_call
    });

    // Add the function result to the conversation
    messages.push({
      role: "function",
      name: name,
      content: JSON.stringify(result)
    });
  }

  // If we hit max iterations, return a message indicating that
  return "I'm sorry, I needed to make too many tool calls to answer your question. Please try rephrasing or breaking it into smaller questions.";
}
