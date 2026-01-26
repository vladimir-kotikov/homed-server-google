/**
 * Capability Mapper Service
 * Converts between Homed device capabilities and Google Smart Home format
 */

import type {
  GoogleCommand,
  GoogleDevice,
  TraitAttributes,
} from "../../types/googleSmarthome.ts";
import type {
  CommandMessage,
  DeviceState,
  EndpointOptions,
} from "../../types/homed.ts";
import {
  detectDeviceType,
  getTraitsForExposes,
} from "../mapper/deviceTypes.ts";
import { TRAIT_MAPPERS } from "../mapper/traits.ts";

/**
 * Homed device structure as received from TCP clients
 */
export interface HomedDevice {
  key: string; // Device identifier (e.g., "0x123456")
  name: string; // Human-readable name
  description?: string; // Optional description
  available: boolean; // Whether device is online
  type?: string; // Optional device type hint
  endpoints: HomedEndpoint[];
}

/**
 * Homed endpoint structure
 */
export interface HomedEndpoint {
  id: number; // Endpoint ID
  name?: string; // Optional endpoint name
  exposes: string[]; // List of capabilities (e.g., ['switch', 'power', 'energy'])
  options?: EndpointOptions; // Optional configuration
}

/**
 * Command structure for execution
 */
export interface HomedCommand {
  topic: string;
  message: CommandMessage;
}

/**
 * Main mapper service for converting between Homed and Google Smart Home
 */
export class CapabilityMapper {
  /**
   * Convert a Homed device to Google Smart Home device format
   *
   * @param homedDevice - Homed device data
   * @param clientId - Unique client/service identifier
   * @returns Google device ready for SYNC intent
   */
  mapToGoogleDevice(homedDevice: HomedDevice, clientId: string): GoogleDevice {
    // Flatten all exposes from all endpoints
    const allExposes = homedDevice.endpoints
      .flatMap(ep => ep.exposes)
      .filter((expose, index, array) => array.indexOf(expose) === index); // Deduplicate

    const deviceType = detectDeviceType(allExposes);
    const traits = getTraitsForExposes(allExposes);

    // Build device ID from client and device key
    // Build the device ID from client and device key
    const googleDeviceId = `${clientId}-${homedDevice.key}`;

    // Build nicknames from alternative names
    const nicknames: string[] = [];
    if (homedDevice.description) {
      nicknames.push(homedDevice.description);
    }

    // Collect all trait attributes using properly typed collection
    const attributes: TraitAttributes = {};
    for (const trait of TRAIT_MAPPERS) {
      if (traits.includes(trait.trait)) {
        const traitAttributes = trait.getAttributes(
          allExposes,
          this.mergeEndpointOptions(homedDevice.endpoints)
        );
        Object.assign(attributes, traitAttributes);
      }
    }

    const googleDevice: GoogleDevice = {
      id: googleDeviceId,
      type: deviceType,
      traits,
      name: {
        defaultNames: [homedDevice.name],
        name: homedDevice.name,
        nicknames,
      },
      willReportState: true,
      attributes: Object.keys(attributes).length > 0 ? attributes : undefined,
      deviceInfo: {
        manufacturer: "Homed",
        model: homedDevice.type || "device",
        hwVersion: "1.0",
        swVersion: "1.0",
      },
      customData: {
        homedKey: homedDevice.key,
        clientId,
        endpoints: homedDevice.endpoints.map(ep => ({
          id: ep.id,
          exposes: ep.exposes,
        })),
      },
    };

    return googleDevice;
  }

  /**
   * Convert Homed device state to Google state
   *
   * @param homedDevice - Homed device (for trait info)
   * @param deviceState - Current device state
   * @returns Google state object ready for QUERY intent
   */
  mapToGoogleState(
    homedDevice: HomedDevice,
    deviceState: DeviceState
  ): Record<string, unknown> {
    const allExposes = homedDevice.endpoints
      .flatMap(endpoint => endpoint.exposes)
      .filter((expose, index, array) => array.indexOf(expose) === index);

    const traits = getTraitsForExposes(allExposes);
    const state: Record<string, unknown> = {
      online: homedDevice.available,
      status: "SUCCESS",
    };

    // Get state for each supported trait - use properly typed TraitState union
    for (const trait of TRAIT_MAPPERS) {
      if (traits.includes(trait.trait)) {
        const traitState = trait.getState(deviceState);
        if (traitState) {
          Object.assign(state, traitState);
        }
      }
    }

    return state;
  }

  /**
   * Convert Google command to Homed topic/message
   *
   * @param homedDevice - Homed device (for routing)
   * @param googleCommand - Google command to execute
   * @returns Command with topic and message, or null if not supported
   */
  mapToHomedCommand(
    homedDevice: HomedDevice,
    googleCommand: GoogleCommand
  ): HomedCommand | undefined {
    const allExposes = homedDevice.endpoints
      .flatMap(ep => ep.exposes)
      .filter((expose, index, array) => array.indexOf(expose) === index);

    const traits = getTraitsForExposes(allExposes);

    // Find matching trait mapper
    for (const trait of TRAIT_MAPPERS) {
      if (traits.includes(trait.trait)) {
        const command = trait.mapCommand(homedDevice.key, googleCommand);
        if (command) {
          return command;
        }
      }
    }

    return;
  }

  /**
   * Merge options from all endpoints
   */
  private mergeEndpointOptions(endpoints: HomedEndpoint[]): EndpointOptions {
    const merged: EndpointOptions = {};
    for (const ep of endpoints) {
      if (ep.options) {
        Object.assign(merged, ep.options);
      }
    }
    return merged;
  }
}

/**
 * Default singleton instance
 */
export const mapper = new CapabilityMapper();
