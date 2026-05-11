import cron from "node-cron";

import { syncUpdatedProducts } from "../../../scripts/sync-products";

export function registerProductSyncJob() {
  cron.schedule("0 */12 * * *", async () => {
    console.log("[ProductSync] Started");

    try {
      await syncUpdatedProducts();

      console.log("[ProductSync] Completed");
    } catch (error) {
      console.error("[ProductSync] Failed", error);
    }
  });
}