import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import { tools } from "./tools.js";
import { KongApi, API_REGIONS } from "./api.js";
import * as analytics from "./operations/analytics.js";
import * as configuration from "./operations/configuration.js";
import * as controlPlanes from "./operations/controlPlanes.js";
import express from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { randomUUID } from "node:crypto";

/**
 * Main MCP server class for Kong Konnect integration
 */
class KongKonnectMcpServer extends McpServer {
  private api: KongApi;

  constructor(options: { apiKey?: string; apiRegion?: string } = {}) {
    super({
      name: "kong-konnect-mcp",
      version: "1.0.0",
      description: "Tools for managing and analyzing Kong Konnect API Gateway configurations and traffic"
    });

    // Initialize the API client
    this.api = new KongApi({
      apiKey: options.apiKey || process.env.KONNECT_ACCESS_TOKEN,
      apiRegion: options.apiRegion || process.env.KONNECT_REGION || API_REGIONS.US
    });

    // Register all tools
    this.registerTools();
  }

  private registerTools() {
    const allTools = tools();

    allTools.forEach(tool => {
      this.tool(
        tool.method,
        tool.description,
        tool.parameters.shape,
        async (args: any, _extra: RequestHandlerExtra<any, any>) => {
          try {
            let result;

            // Route to appropriate handler based on method
            switch (tool.method) {
              // Analytics tools
              case "query_api_requests":
                result = await analytics.queryApiRequests(
                  this.api,
                  args.timeRange,
                  args.statusCodes,
                  args.excludeStatusCodes,
                  args.httpMethods,
                  args.consumerIds,
                  args.serviceIds,
                  args.routeIds,
                  args.maxResults
                );
                break;

              case "get_consumer_requests":
                result = await analytics.getConsumerRequests(
                  this.api,
                  args.consumerId,
                  args.timeRange,
                  args.successOnly,
                  args.failureOnly,
                  args.maxResults
                );
                break;

              // Configuration tools
              case "list_services":
                result = await configuration.listServices(
                  this.api,
                  args.controlPlaneId,
                  args.size,
                  args.offset
                );
                break;

              case "list_routes":
                result = await configuration.listRoutes(
                  this.api,
                  args.controlPlaneId,
                  args.size,
                  args.offset
                );
                break;

              case "list_consumers":
                result = await configuration.listConsumers(
                  this.api,
                  args.controlPlaneId,
                  args.size,
                  args.offset
                );
                break;

              case "list_plugins":
                result = await configuration.listPlugins(
                  this.api,
                  args.controlPlaneId,
                  args.size,
                  args.offset
                );
                break;

              // Control Planes tools
              case "list_control_planes":
                result = await controlPlanes.listControlPlanes(
                  this.api,
                  args.pageSize,
                  args.pageNumber,
                  args.filterName,
                  args.filterClusterType,
                  args.filterCloudGateway,
                  args.labels,
                  args.sort
                );
                break;

              case "get_control_plane":
                result = await controlPlanes.getControlPlane(
                  this.api,
                  args.controlPlaneId
                );
                break;

              case "list_control_plane_group_memberships":
                result = await controlPlanes.listControlPlaneGroupMemberships(
                  this.api,
                  args.groupId,
                  args.pageSize,
                  args.pageAfter
                );
                break;

              case "check_control_plane_group_membership":
                result = await controlPlanes.checkControlPlaneGroupMembership(
                  this.api,
                  args.controlPlaneId
                );
                break;
                
              default:
                throw new Error(`Unknown tool method: ${tool.method}`);
            }

            const resultJson = JSON.stringify(result, null, 2);

            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(result, null, 2)
                }
              ]
            };
          } catch (error: any) {
            return {
              content: [
                {
                  type: "text",
                  text: `Error: ${error.message}\n\nTroubleshooting tips:\n1. Verify your API key is valid and has sufficient permissions\n2. Check that the parameters provided are valid\n3. Ensure your network connection to the Kong API is working properly`
                }
              ],
              isError: true
            };
          }
        }
      );
    });
  }
}

/**
 * Main function to run the server
 */
async function main() {
  // Get API key and region from environment if not provided
  const apiKey = process.env.KONNECT_ACCESS_TOKEN;
  const apiRegion = process.env.KONNECT_REGION || API_REGIONS.US;

  const app = express();

  app.use(express.json());

  const transports = {
    streamable: {} as Record<string, StreamableHTTPServerTransport>
  };

  // Create server instance
  const server = new KongKonnectMcpServer({
    apiKey,
    apiRegion
  });

  app.post('/mcp', async (req, res) => {
    // Check for existing session ID
    console.log("mcp request", req.body);
    console.log("isInitializeRequest result:", isInitializeRequest(req.body));
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    let transport: StreamableHTTPServerTransport;
  
    if (sessionId && transports.streamable[sessionId]) {
      // Reuse existing transport
      transport = transports.streamable[sessionId];
    } else if (!sessionId && isInitializeRequest(req.body)) {
      // New initialization request
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sessionId) => {
          // Store the transport by session ID
          transports.streamable[sessionId] = transport;
        }
      });
  
      // Clean up transport when closed
      transport.onclose = () => {
        if (transport.sessionId) {
          delete transports.streamable[transport.sessionId];
        }
      };
  
      // Connect to the MCP server
      await server.connect(transport);
    } else {
      // Invalid request
      res.status(400).json({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: 'Bad Request: No valid session ID provided',
        },
        id: null,
      });
      return;
    }
  
    // Handle the request
    await transport.handleRequest(req, res, req.body);
  });
  
  // Reusable handler for GET and DELETE requests
  const handleSessionRequest = async (req: express.Request, res: express.Response) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    if (!sessionId || !transports.streamable[sessionId]) {
      res.status(400).send('Invalid or missing session ID');
      return;
    }
    
    const transport = transports.streamable[sessionId];
    await transport.handleRequest(req, res);
  };
  
  // Handle GET requests for server-to-client notifications via SSE
  app.get('/mcp', handleSessionRequest);
  
  // Handle DELETE requests for session termination
  app.delete('/mcp', handleSessionRequest);

  app.listen(3001);

}

// Run the server
main().catch((error) => {
  console.error("Initialization error:", error);
  process.exit(1);
});
