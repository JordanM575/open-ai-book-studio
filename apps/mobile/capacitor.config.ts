import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "studio.aibook.app",
  appName: "AI Book Studio",
  webDir: "../web/dist",
  ios: {
    contentInset: "never",
    preferredContentMode: "mobile",
    backgroundColor: "#0f1117"
  }
};

export default config;
