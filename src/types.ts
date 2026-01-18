// Google Smart Home API Types

// Base types for all requests and responses
export type SmartHomeRequest =
  | SyncRequest
  | QueryRequest
  | ExecuteRequest
  | DisconnectRequest;

export type SmartHomeResponse =
  | SyncResponse
  | QueryResponse
  | ExecuteResponse
  | DisconnectResponse;

export interface SyncRequest {
  requestId: string;
  inputs: [{ intent: "action.devices.SYNC" }];
}

export interface SyncResponse {
  requestId: string;
  payload: {
    agentUserId: string;
    devices: GoogleDevice[];
  };
}

export interface QueryRequest {
  requestId: string;
  inputs: [
    {
      intent: "action.devices.QUERY";
      payload: {
        devices: [{ id: string }];
      };
    },
  ];
}

export interface QueryResponse {
  requestId: string;
  payload: {
    devices: {
      [deviceId: string]: {
        online: boolean;
        status: string;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        [key: string]: any;
      };
    };
  };
}

export interface ExecuteRequest {
  requestId: string;
  inputs: [
    {
      intent: "action.devices.EXECUTE";
      payload: {
        commands: [
          {
            devices: [{ id: string }];
            execution: [
              {
                command: string;
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                params?: any;
              },
            ];
          },
        ];
      };
    },
  ];
}

export interface ExecuteResponse {
  requestId: string;
  payload: {
    commands: Array<{
      ids: string[];
      status: "SUCCESS" | "PENDING" | "OFFLINE" | "ERROR";
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      states?: any;
      errorCode?: string;
    }>;
  };
}

export interface DisconnectRequest {
  requestId: string;
  inputs: [{ intent: "action.devices.DISCONNECT" }];
}

export interface DisconnectResponse {
  requestId: string;
  payload: Record<string, never>;
}

export interface GoogleDevice {
  id: string;
  type: string;
  traits: string[];
  name: {
    defaultNames: string[];
    name: string;
    nicknames: string[];
  };
  willReportState: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  attributes?: Record<string, any>;
  deviceInfo?: {
    manufacturer: string;
    model: string;
    hwVersion: string;
    swVersion: string;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  customData?: any;
}

export interface GoogleCommand {
  command: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  params?: any;
}

// User type from Drizzle ORM schema (src/db/schema.ts)
export interface User {
  id: string;
  username: string;
  passwordHash: string;
  clientToken: string;
  createdAt: Date;
}
