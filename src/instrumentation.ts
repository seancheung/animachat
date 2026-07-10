export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { seedPresets } = await import("./lib/seed");
    try {
      seedPresets();
    } catch (e) {
      console.error("seed failed", e);
    }
  }
}
