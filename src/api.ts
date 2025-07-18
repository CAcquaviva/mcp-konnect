import axios, { AxiosRequestConfig } from "axios";
import https from "node:https";
import { 
  ApiRequestFilter, 
  TimeRange, 
  ApiRequestsResponse 
} from "./types.js";

/**
 * Kong API Regions - Different geographical API endpoints 
 */
export const API_REGIONS = {
  US: "us",
  EU: "eu",
  AU: "au",
  ME: "me",
  IN: "in",
};

export interface KongApiOptions {
  apiKey?: string;
  apiRegion?: string;
}

export class KongApi {
  private baseUrl: string;
  private apiKey: string;

  constructor(options: KongApiOptions = {}) {
    // Default to US region if not specified
    const apiRegion = options.apiRegion || process.env.KONNECT_REGION || API_REGIONS.US;
    //this.baseUrl = `https://konnect-api.kong-sales-engineering.com/v2`;
    this.baseUrl = `https://${apiRegion}.api.konghq.com/v2`;
    this.apiKey = options.apiKey || process.env.KONNECT_ACCESS_TOKEN || "";

    if (!this.apiKey) {
      console.error("Warning: KONNECT_ACCESS_TOKEN not set in environment. API calls will fail.");
    }
  }

  /**
   * Makes authenticated requests to Kong APIs with consistent error handling
   */
  async kongRequest<T>(endpoint: string, method = "GET", data: any = null): Promise<T> {
    try {
      const url = `${this.baseUrl}${endpoint}`;
      console.error(`Making request to: ${url}`);

      const headers = {
        //"apikey": `${this.apiKey}`,
        "Authorization": `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        "Accept": "application/json"
      };

      const config: AxiosRequestConfig = {
        method,
        url,
        headers,
        data: data ? data : undefined,
        httpsAgent: new https.Agent({
          rejectUnauthorized: false
        })
      };

      const response = await axios(config);
      console.error(`Received response with status: ${response.status}`);
      
      return response.data;
    } catch (error: any) {
      console.error("API request error:", error.message);

      if (error.response) {
        const errorData = error.response.data;
        let errorMessage = `API Error (Status ${error.response.status})`;

        if (typeof errorData === 'object') {
          const errorDetails = errorData.message || JSON.stringify(errorData);
          errorMessage += `: ${errorDetails}`;
        } else if (typeof errorData === 'string') {
          errorMessage += `: ${errorData.substring(0, 200)}`;
        }

        throw new Error(errorMessage);
      } else if (error.request) {
        throw new Error("Network Error: No response received from Kong API. Please check your network connection and API endpoint configuration.");
      } else {
        throw new Error(`Request Error: ${error.message}. Please check your request parameters and try again.`);
      }
    }
  }

  // Analytics API methods
  async queryApiRequests(timeRange: string, filters: ApiRequestFilter[] = [], maxResults = 100): Promise<ApiRequestsResponse> {
    const requestBody = {
      time_range: {
        type: "relative",
        time_range: timeRange
      } as TimeRange,
      filters: filters,
      size: maxResults
    };

    return this.kongRequest<ApiRequestsResponse>("/api-requests", "POST", requestBody);
  }

  // Control Planes API methods
  async listControlPlanes(pageSize = 10, pageNumber?: number, filterName?: string, filterClusterType?: string, 
    filterCloudGateway?: boolean, labels?: string, sort?: string): Promise<any> {
    let endpoint = `/control-planes?page[size]=${pageSize}`;

    if (pageNumber) {
      endpoint += `&page[number]=${pageNumber}`;
    }

    if (filterName) {
      endpoint += `&filter[name][contains]=${encodeURIComponent(filterName)}`;
    }
    
    if (filterClusterType) {
      endpoint += `&filter[cluster_type][eq]=${encodeURIComponent(filterClusterType)}`;
    }
    
    if (filterCloudGateway !== undefined) {
      endpoint += `&filter[cloud_gateway]=${filterCloudGateway}`;
    }

    if (labels) {
      endpoint += `&labels=${encodeURIComponent(labels)}`;
    }

    if (sort) {
      endpoint += `&sort=${encodeURIComponent(sort)}`;
    }

    return this.kongRequest<any>(endpoint);
  }

  async getControlPlane(controlPlaneId: string): Promise<any> {
    return this.kongRequest<any>(`/control-planes/${controlPlaneId}`);
  }

  async listControlPlaneGroupMemberships(groupId: string, pageSize = 10, pageAfter?: string): Promise<any> {
    let endpoint = `/control-planes/${groupId}/group-memberships?page[size]=${pageSize}`;

    if (pageAfter) {
      endpoint += `&page[after]=${pageAfter}`;
    }

    return this.kongRequest<any>(endpoint);
  }

  async checkControlPlaneGroupMembership(controlPlaneId: string): Promise<any> {
    return this.kongRequest<any>(`/control-planes/${controlPlaneId}/group-member-status`);
  }

  // Configuration API methods
  async listServices(controlPlaneId: string, size = 100, offset?: string): Promise<any> {
    let endpoint = `/control-planes/${controlPlaneId}/core-entities/services?size=${size}`;
    
    if (offset) {
      endpoint += `&offset=${offset}`;
    }

    return this.kongRequest<any>(endpoint);
  }

  async listRoutes(controlPlaneId: string, size = 100, offset?: string): Promise<any> {
    let endpoint = `/control-planes/${controlPlaneId}/core-entities/routes?size=${size}`;
    
    if (offset) {
      endpoint += `&offset=${offset}`;
    }

    return this.kongRequest<any>(endpoint);
  }

  async listConsumers(controlPlaneId: string, size = 100, offset?: string): Promise<any> {
    let endpoint = `/control-planes/${controlPlaneId}/core-entities/consumers?size=${size}`;
    
    if (offset) {
      endpoint += `&offset=${offset}`;
    }

    return this.kongRequest<any>(endpoint);
  }

  async listPlugins(controlPlaneId: string, size = 100, offset?: string): Promise<any> {
    let endpoint = `/control-planes/${controlPlaneId}/core-entities/plugins?size=${size}`;
    
    if (offset) {
      endpoint += `&offset=${offset}`;
    }

    return this.kongRequest<any>(endpoint);
  }
}