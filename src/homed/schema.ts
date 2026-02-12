import { z } from "zod";

// Some of the exposes are described here
// https://wiki.homed.dev/common/exposes/#switch

/**
 * Helper to create Homed enum type schema
 * @param values enum values
 * @returns Homed enum type schema
 */
const HomedEnum = (values: string[]) =>
  z.object({
    enum: z.array(z.union(values.map(v => z.literal(v)))),
  });

const LiteralEnum = <T extends z.util.Literal>(values: T[]) =>
  z.union(values.map(v => z.literal(v)));

const BaseExposeOptionsSchema = z
  .object({ icon: z.string(), title: z.string() })
  .partial();

const ClassExposeOptionsSchemaMixin = z.object({
  class: z.string().optional(),
});

const StateExposeOptionsSchemaMixin = z.object({
  state: z
    .union([z.literal("measurement"), z.literal("total_increasing")])
    .optional(),
});

const BinarySensorOptionsSchema = z.object({
  type: z.literal("binary"),
  ...BaseExposeOptionsSchema.shape,
  ...ClassExposeOptionsSchemaMixin.shape,
});

const SensorOptionsSchema = z.object({
  type: z.literal("sensor"),
  unit: z.string().optional(),
  round: z.number().optional(),
  ...BaseExposeOptionsSchema.shape,
  ...ClassExposeOptionsSchemaMixin.shape,
  ...StateExposeOptionsSchemaMixin.shape,
});

const ToggleOptionsSchema = z.object({
  type: z.literal("toggle"),
  ...BaseExposeOptionsSchema.shape,
});

const NumberOptionsSchema = z.object({
  type: z.literal("number"),
  min: z.number(),
  max: z.number(),
  step: z.number().optional(),
  unit: z.string().optional(),
  collapse: z.boolean().optional(),
  ...BaseExposeOptionsSchema.shape,
});

const SelectOptionsSchema = z.object({
  type: z.literal("select"),
  enum: z
    .union([z.array(z.string()), z.record(z.string(), z.string())])
    .optional(),
  collapse: z.boolean().optional(),
  ...BaseExposeOptionsSchema.shape,
});

const TriggerOptionsSchema = z.object({
  type: z.literal("button"),
  ...BaseExposeOptionsSchema.shape,
});

const KnownEndpointOptionsSchema = z.union([
  BinarySensorOptionsSchema,
  SensorOptionsSchema,
  ToggleOptionsSchema,
  NumberOptionsSchema,
  SelectOptionsSchema,
  TriggerOptionsSchema,
]);

// Special expose schemas - their options are not keyed under
// the expose name but are merged into the options object
const SwitchOptionsSchema = z.object({ switch: z.literal("outlet") }).partial();
const LockOptionsSchema = z.object({ lock: z.literal("valve") }).partial();
const LightOptionsSchema = z
  .object({
    light: z.array(
      z.union([
        z.literal("level"),
        z.literal("color"),
        z.literal("colorTemperature"),
        z.literal("colorMode"),
      ])
    ),
    colorTemperature: z.object({
      min: z.number().optional(),
      max: z.number().optional(),
    }),
  })
  .partial();

const CoverOptionsSchema = z
  .object({
    cover: z.literal("blind"),
    invertCover: z.boolean(),
  })
  .partial();

const ThermostatOptionsSchema = z
  .object({
    systemMode: HomedEnum(["off", "auto", "cool", "heat", "dry", "fan"]),
    operationMode: z.object({
      enum: z.array(z.string()),
    }),
    targetTemperature: z.object({
      min: z.number().optional(),
      max: z.number().optional(),
    }),
    runningStatus: z.boolean(),
  })
  .partial();

/**
 * options:
 * { switch?: "outlet" } &
 * { lock?: "valve" } &
 * {
 *    light?: ("level" | "color" | "colorTemperature" | "colorMode")[];
 *    colorTemperature?: { min: number; max: number };
 * } &
 * {
 *    cover?: "blind";
 *    invertCover?: boolean;
 * } &
 * // Thermostat
 * {
 *    systemMode?: {"enum": ["off", "heat"]},
 *    operationMode?: {"enum": ["manual", "comfort"]},
 *    targetTemperature?: { min?: number?, max?: number },
 *    runningStatus?: true
 * } &
 * {
 *  [exp: string]:
 *    SensorOptions |
 *    BinarySensorOptions |
 *    ToggleOptions |
 *    NumberOptions |
 *    SelectOptions |
 *    TriggerOptions;
 * }
 */
const SpecialEndpointOptionsSchema = z.object({
  ...SwitchOptionsSchema.shape,
  ...LockOptionsSchema.shape,
  ...LightOptionsSchema.shape,
  ...CoverOptionsSchema.shape,
  ...ThermostatOptionsSchema.shape,
});

export const EndpointOptionsSchema = SpecialEndpointOptionsSchema.superRefine(
  (data, context) => {
    const specialProperties = new Set(
      Object.keys(SpecialEndpointOptionsSchema.shape)
    );

    for (const [key, value] of Object.entries(data)) {
      if (specialProperties.has(key)) {
        continue;
      }

      const result = KnownEndpointOptionsSchema.safeParse(value);
      if (!result.success) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `Invalid expose property: ${result.error.message}`,
        });
      }
    }
  }
);

export type EndpointOptions = z.infer<typeof SpecialEndpointOptionsSchema> & {
  [key: string]: z.infer<typeof KnownEndpointOptionsSchema>;
};
export const DeviceExposesMessageSchema = z.record(
  z.string(),
  z.object({
    // array of exposes: switch, light, etc.
    items: z.array(
      z.union([
        LiteralEnum(["switch", "lock", "light", "cover", "thermostat"]),
        z.string(),
      ])
    ),
    options: EndpointOptionsSchema.optional(),
  })
);

export const ZigbeeDeviceInfoSchema = z
  .object({
    ieeeAddress: z.string(),
    name: z.string().optional(),
    description: z.string().optional(),
    discovery: z.boolean().optional(),
    cloud: z.boolean().optional(),
    active: z.boolean().optional(),
    manufacturerCode: z.number().optional(),
    manufacturerName: z.string().optional(),
    modelName: z.string().optional(),
    supported: z.boolean().optional(),
    removed: z.boolean().optional(),
    lastSeen: z.number().optional(),
    linkQuality: z.number().optional(),
    firmware: z.string().optional(),
    version: z.coerce.string().optional(),
  })
  .loose();

export const DeviceInfoSchema = z.union([ZigbeeDeviceInfoSchema]);

export const ClientStatusMessageSchema = z
  .object({
    devices: z.array(DeviceInfoSchema).optional(),
    names: z.boolean().optional(),
    timestamp: z.number().optional(),
  })
  .loose(); // Allow additional unknown fields

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

export const ClientAuthMessageSchema = z.object({
  uniqueId: z.string(),
  token: z.string(),
});

export const ClientMessageSchema = z.object({
  topic: z.string().min(1, "Field 'topic' cannot be empty"),
  message: z
    .union([
      ClientStatusMessageSchema, // status/ topic
      DeviceExposesMessageSchema, // expose/ topic
      DeviceStatusMessageSchema, // device/ topic
      DeviceStateMessageSchema, // fd/ topic
    ])
    .optional(),
});

export type AuthorizationMessage = z.infer<typeof AuthorizationMessageSchema>;
export type ClientMessage = z.infer<typeof ClientMessageSchema>;
export type ServerMessage<T = unknown> = {
  topic: string;
  action: "publish" | "subscribe";
  // TODO: refine this type based on topic
  message?: T;
};

export type ClientStatusMessage = z.infer<typeof ClientStatusMessageSchema>;
export type DeviceExposesMessage = z.infer<typeof DeviceExposesMessageSchema>;
export type DeviceStatusMessage = z.infer<typeof DeviceStatusMessageSchema>;
export type DeviceStateMessage = z.infer<typeof DeviceStateMessageSchema>;
