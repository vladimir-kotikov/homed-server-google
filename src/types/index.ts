// Google Smart Home API Types

export interface SyncRequest {
  requestId: string;
  inputs: [{ intent: 'action.devices.SYNC' }];
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
  inputs: [{
    intent: 'action.devices.QUERY';
    payload: {
      devices: [{ id: string }];
    };
  }];
}

export interface QueryResponse {
  requestId: string;
  payload: {
    devices: {
      [deviceId: string]: {
        online: boolean;
        status: string;
        [key: string]: any;
      };
    };
  };
}

export interface ExecuteRequest {
  requestId: string;
  inputs: [{
    intent: 'action.devices.EXECUTE';
    payload: {
      commands: [{
        devices: [{ id: string }];
        execution: [{
          command: string;
          params?: any;
        }];
      }];
    };
  }];
}

export interface ExecuteResponse {
  requestId: string;
  payload: {
    commands: [{
      ids: string[];
      status: 'SUCCESS' | 'PENDING' | 'OFFLINE' | 'ERROR';
      states?: any;
      errorCode?: string;
    }];
  };
}

export interface DisconnectRequest {
  requestId: string;
  inputs: [{ intent: 'action.devices.DISCONNECT' }];
}

export interface DisconnectResponse {
  // Empty response
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
  attributes?: Record<string, any>;
  deviceInfo?: {
    manufacturer: string;
    model: string;
    hwVersion: string;
    swVersion: string;
  };
  customData?: any;
}

export interface GoogleCommand {
  command: string;
  params?: any;
}

// Prisma User type (will be imported from @prisma/client after generation)
export interface User {
  id: string;
  username: string;
  passwordHash: string;
  clientToken: string;
  createdAt: Date;
}
