/**
 * Protocol Message Schemas using Zod
 *
 * These schemas validate messages from the Homed TCP protocol.
 *
 * Generated from: src/types/protocol-messages.ts
 */

import { z } from "zod";

const SensorOptionsSchema = z.object({
  type: z.literal("sensor"),
  class: z.string(),
  round: z.number(),
  unit: z.string(),
  state: z.string().optional(),
  enum: z.array(z.string()).optional(),
  icon: z.string().optional(),
});

const NumberOptionsSchema = z.object({
  type: z.literal("number"),
  min: z.number(),
  max: z.number(),
  step: z.number().optional(),
  unit: z.string(),
  icon: z.string().optional(),
});

const ToggleOptionsSchema = z.object({
  type: z.literal("toggle"),
  icon: z.string().optional(),
});

const SelectOptionsSchema = z.object({
  type: z.literal("select"),
  icon: z.string().optional(),
  enum: z
    .union([z.array(z.string()), z.record(z.string(), z.string())])
    .optional(),
});

const LightOptionsSchema = z.array(z.literal("level"));

const OutletOptionsSchema = z.literal("outlet");

// TODO: Based only on my own devices, need to be refined based on the service code
export const EndpointOptionsSchema = z.union([
  SensorOptionsSchema,
  NumberOptionsSchema,
  ToggleOptionsSchema,
  SelectOptionsSchema,
  LightOptionsSchema,
  OutletOptionsSchema,
]);

export const DeviceExposesMessageSchema = z.record(
  z.string(),
  z.object({
    items: z.array(z.string() /* array of exposes: switch, light, etc. */),
    options: EndpointOptionsSchema.optional(),
  })
);

export const ZigbeeDeviceListItemSchema = z
  .object({
    active: z.boolean().optional(),
    cloud: z.boolean(),
    description: z.string().optional(),
    discovery: z.boolean().optional(),
    ieeeAddress: z.string().optional(),
    lastSeen: z.number().optional(),
    linkQuality: z.number().optional(),
    manufacturerCode: z.number().optional(),
    manufacturerName: z.string().optional(),
    modelName: z.string().optional(),
    name: z.string().optional(),
    networkAddress: z.number().optional(),
    supported: z.boolean().optional(),
  })
  .loose();

export const DeviceListMessageSchema = z
  .object({
    devices: z.array(ZigbeeDeviceListItemSchema).optional(),
    names: z.boolean().optional(),
    timestamp: z.number().optional(),
  })
  .strict();

export const AuthorizationMessageSchema = z
  .object({
    uniqueId: z.string(),
    token: z.string(),
  })
  .strict();

export const DeviceStatusMessageSchema = z
  .object({
    status: z.union([z.literal("online"), z.string()]),
    lastSeen: z.number().optional(),
  })
  .strict();

export const DeviceStateMessageSchema = z.record(
  z.string(), // TODO: should be a enum of exposes, but use string for safety
  z.unknown()
);

export const ProtocolMessageDataSchema = z.union([
  DeviceListMessageSchema, // status/ topic
  DeviceExposesMessageSchema, // expose/ topic
  DeviceStatusMessageSchema, // device/ topic
  DeviceStateMessageSchema, // fd/ topic
]);

export const ClientMessageSchema = z.object({
  topic: z.string(),
  message: ProtocolMessageDataSchema.optional(),
});

export type AuthorizationMessage = z.infer<typeof AuthorizationMessageSchema>;
export type ClientMessage = z.infer<typeof ClientMessageSchema>;
export type ServerMessage<T = unknown> = {
  topic: string;
  action: "publish" | "subscribe";
  // TODO: refine this type based on topic
  message?: T;
};

export type DeviceListMessage = z.infer<typeof DeviceListMessageSchema>;
export type DeviceExposesMessage = z.infer<typeof DeviceExposesMessageSchema>;
export type DeviceStatusMessage = z.infer<typeof DeviceStatusMessageSchema>;
export type DeviceStateMessage = z.infer<typeof DeviceStateMessageSchema>;
