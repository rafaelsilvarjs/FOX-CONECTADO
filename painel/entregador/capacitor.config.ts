import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.foxlog.entregador",
  appName: "FoxLog Entregador",
  webDir: "build",
  server: {
    androidScheme: "https"
  }
};

export default config;
