import type { HomedDevice } from "../device.ts";

export class HomeGraphClient {
  updateDevices = async (_userId: string, _endpoints: HomedDevice[]) => {};
}
