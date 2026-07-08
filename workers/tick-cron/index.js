const worker = {
  async scheduled(event, env) {
    const url = env.TICK_URL || "https://las-vegas.vercel.app/api/agent/tick";
    const secret = env.CRON_SECRET;

    if (!secret) {
      console.error("CRON_SECRET not set");
      return;
    }

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${secret}`
        }
      });

      const body = await response.text();
      console.log(`Tick ${response.status}: ${body}`);
    } catch (error) {
      console.error(`Tick failed: ${error.message}`);
    }
  }
};

export default worker;
